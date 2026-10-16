param(
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$DesktopPid,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$DialogTitle,
    [ValidateSet('choose', 'cancel', 'inspect')][string]$Action = 'choose',
    [ValidateSet('file', 'folder', 'save')][string]$Kind = 'file',
    [string]$Path,
    [ValidateRange(1, 30)][int]$TimeoutSeconds = 15
)

# Run this helper with -WindowStyle Hidden. It acts only on an explicitly named
# native dialog owned by the supplied Agent Bay desktop PID. It never sends keys
# to the foreground window or changes another application's focus.
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This native-dialog helper requires Windows.' }
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$desktopProcess = Get-Process -Id $DesktopPid -ErrorAction Stop
if ($desktopProcess.ProcessName -ne 'agent-bay-desktop') {
    throw "PID $DesktopPid is not an Agent Bay desktop process."
}
if ($Action -eq 'choose') {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not [System.IO.Path]::IsPathRooted($Path)) {
        throw 'Choose requires an absolute -Path.'
    }
    $Path = [System.IO.Path]::GetFullPath($Path)
    if ($Kind -eq 'file' -and -not [System.IO.File]::Exists($Path)) { throw 'The selected file does not exist.' }
    if ($Kind -eq 'folder' -and -not [System.IO.Directory]::Exists($Path)) { throw 'The selected folder does not exist.' }
    if ($Kind -eq 'save' -and -not [System.IO.Directory]::Exists([System.IO.Path]::GetDirectoryName($Path))) {
        throw 'The export destination directory does not exist.'
    }
    if ($Kind -eq 'save' -and [System.IO.File]::Exists($Path)) {
        throw 'Use a new export filename; this helper does not confirm overwriting existing files.'
    }
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public static class AgentBayDialogWindow {
    private delegate bool EnumCallback(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsChild(IntPtr parent, IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder title, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr SendText(IntPtr window, uint message, IntPtr wParam, string lParam, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", SetLastError = true)]
    private static extern IntPtr SendSignal(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr ReadText(IntPtr window, uint message, IntPtr wParam, StringBuilder lParam, uint flags, uint timeout, out IntPtr result);

    private static string ClassName(IntPtr window) {
        var value = new StringBuilder(64); GetClassName(window, value, value.Capacity); return value.ToString();
    }
    private static string Title(IntPtr window) {
        var value = new StringBuilder(32768); GetWindowText(window, value, value.Capacity); return value.ToString();
    }
    private static bool OwnedChild(IntPtr dialog, IntPtr child, uint processId) {
        uint actual; GetWindowThreadProcessId(child, out actual);
        return IsWindow(child) && IsChild(dialog, child) && actual == processId;
    }
    public static object[] Controls(IntPtr dialog, uint processId) {
        var result = new List<object>();
        EnumChildWindows(dialog, (child, parameter) => {
            var name = ClassName(child);
            if (OwnedChild(dialog, child, processId) && (name == "Edit" || name == "ComboBox" || name == "ComboBoxEx32")) {
                result.Add(new { id = GetDlgCtrlID(child), parentId = GetDlgCtrlID(GetParent(child)), name = Title(child), className = name, visible = IsWindowVisible(child) });
            }
            return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }
    public static IntPtr FilenameEdit(IntPtr dialog, uint processId, bool folder, bool save) {
        var host = IntPtr.Zero;
        EnumChildWindows(dialog, (child, parameter) => {
            var name = ClassName(child);
            if (GetDlgCtrlID(child) != (folder ? 1152 : 1148) || !OwnedChild(dialog, child, processId) || !IsWindowVisible(child) ||
                (name != "Edit" && name != "ComboBox" && name != "ComboBoxEx32")) return true;
            host = child; return false;
        }, IntPtr.Zero);
        if (host == IntPtr.Zero && save) {
            // The Windows 11 Save As filename is Edit 1001 inside an anonymous
            // ComboBox. Hidden address-bar edits use a different host and are
            // never candidates. Reject ambiguity instead of choosing arbitrarily.
            var candidates = new List<IntPtr>();
            EnumChildWindows(dialog, (child, parameter) => {
                var parent = GetParent(child);
                if (GetDlgCtrlID(child) == 1001 && ClassName(child) == "Edit" &&
                    ClassName(parent) == "ComboBox" && GetDlgCtrlID(parent) == 0 &&
                    OwnedChild(dialog, child, processId) && IsWindowVisible(child) && IsWindowEnabled(child)) candidates.Add(child);
                return true;
            }, IntPtr.Zero);
            return candidates.Count == 1 ? candidates[0] : IntPtr.Zero;
        }
        if (host == IntPtr.Zero || ClassName(host) == "Edit") return host;
        var edit = IntPtr.Zero;
        EnumChildWindows(host, (child, parameter) => {
            if (ClassName(child) != "Edit" || !OwnedChild(dialog, child, processId) || !IsWindowVisible(child)) return true;
            edit = child; return false;
        }, IntPtr.Zero);
        return edit;
    }
    public static bool SetFilename(IntPtr dialog, IntPtr edit, uint processId, string path) {
        if (!OwnedChild(dialog, edit, processId) || ClassName(edit) != "Edit" || !IsWindowVisible(edit) || !IsWindowEnabled(edit)) return false;
        IntPtr result;
        if (SendText(edit, 0x000C, IntPtr.Zero, path, 0x0002, 5000, out result) == IntPtr.Zero) return false;
        // GetWindowText does not read foreign-process edit values. WM_GETTEXT
        // provides a scoped roundtrip without keyboard or focus manipulation.
        var actual = new StringBuilder(32768);
        return ReadText(edit, 0x000D, new IntPtr(actual.Capacity), actual, 0x0002, 5000, out result) != IntPtr.Zero &&
            String.Equals(actual.ToString(), path, StringComparison.OrdinalIgnoreCase);
    }
    public static bool Confirm(IntPtr dialog, uint processId) {
        var button = IntPtr.Zero;
        EnumChildWindows(dialog, (child, parameter) => {
            if (GetDlgCtrlID(child) != 1 || ClassName(child) != "Button" || !OwnedChild(dialog, child, processId) || !IsWindowVisible(child) || !IsWindowEnabled(child)) return true;
            button = child; return false;
        }, IntPtr.Zero);
        if (button == IntPtr.Zero) return false;
        IntPtr result;
        return SendSignal(button, 0x00F5, IntPtr.Zero, IntPtr.Zero, 0x0002, 5000, out result) != IntPtr.Zero;
    }

    public static bool Matches(IntPtr window, uint processId, string expectedTitle) {
        uint actualProcess;
        GetWindowThreadProcessId(window, out actualProcess);
        var title = new StringBuilder(512);
        var name = new StringBuilder(64);
        GetWindowText(window, title, title.Capacity);
        GetClassName(window, name, name.Capacity);
        return IsWindow(window) && IsWindowVisible(window) && actualProcess == processId &&
            name.ToString() == "#32770" && String.Equals(title.ToString(), expectedTitle, StringComparison.Ordinal);
    }

    public static IntPtr Find(uint processId, string expectedTitle) {
        var found = IntPtr.Zero;
        EnumWindows((window, parameter) => {
            if (!Matches(window, processId, expectedTitle)) return true;
            found = window;
            return false;
        }, IntPtr.Zero);
        return found;
    }
}
'@

$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
$dialogHandle = [IntPtr]::Zero
while ([DateTime]::UtcNow -lt $deadline) {
    $dialogHandle = [AgentBayDialogWindow]::Find([uint32]$DesktopPid, $DialogTitle)
    if ($dialogHandle -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 100
}
if ($dialogHandle -eq [IntPtr]::Zero) { throw "Native dialog '$DialogTitle' was not found for PID $DesktopPid." }
$dialog = [System.Windows.Automation.AutomationElement]::FromHandle($dialogHandle)

function Find-DialogControl([string]$AutomationId, $ControlType) {
    $idCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $AutomationId)
    $typeCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ControlType)
    $condition = [System.Windows.Automation.AndCondition]::new($idCondition, $typeCondition)
    return $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Assert-DialogOwner {
    if (-not [AgentBayDialogWindow]::Matches($dialogHandle, [uint32]$DesktopPid, $DialogTitle)) {
        throw 'The explicitly selected native dialog is no longer owned by the supplied desktop process.'
    }
}

function Get-ScopedControlSummary {
    $script:desktopScopedControls = [System.Collections.Generic.List[object]]::new()
    $script:desktopControlsVisited = 0
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    function Visit-DialogChildren($Parent, [int]$Depth) {
        if ($Depth -gt 14 -or $script:desktopControlsVisited -ge 250) { return }
        $control = $walker.GetFirstChild($Parent)
        while ($null -ne $control -and $script:desktopControlsVisited -lt 250) {
            $script:desktopControlsVisited++
            $type = $control.Current.ControlType
            # Explorer file rows expose editable metadata cells. Do not enter or
            # report file lists, navigation trees, or their item descendants.
            $skip = $type -in @([System.Windows.Automation.ControlType]::List,
                [System.Windows.Automation.ControlType]::DataGrid,
                [System.Windows.Automation.ControlType]::Tree,
                [System.Windows.Automation.ControlType]::ListItem,
                [System.Windows.Automation.ControlType]::DataItem,
                [System.Windows.Automation.ControlType]::TreeItem)
            if (-not $skip) {
                if (($type -eq [System.Windows.Automation.ControlType]::Edit -or
                    $type -eq [System.Windows.Automation.ControlType]::ComboBox) -and
                    $control.Current.ClassName -ne 'UIProperty' -and
                    -not $control.Current.AutomationId.StartsWith('System.')) {
                    $script:desktopScopedControls.Add(@{ id = $control.Current.AutomationId;
                        name = $control.Current.Name; type = $type.ProgrammaticName;
                        className = $control.Current.ClassName; enabled = $control.Current.IsEnabled;
                        offscreen = $control.Current.IsOffscreen })
                }
                Visit-DialogChildren $control ($Depth + 1)
            }
            $control = $walker.GetNextSibling($control)
        }
    }
    Visit-DialogChildren $dialog 0
    return $script:desktopScopedControls.ToArray()
}

function Find-FilenameControl {
    foreach ($controlId in @('1148', '1001')) {
        $edit = Find-DialogControl $controlId ([System.Windows.Automation.ControlType]::Edit)
        if ($null -ne $edit -and -not $edit.Current.IsOffscreen) { return $edit }
        $combo = Find-DialogControl $controlId ([System.Windows.Automation.ControlType]::ComboBox)
        if ($null -eq $combo -or $combo.Current.IsOffscreen) { continue }
        $editType = [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit)
        $edit = $combo.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editType)
        if ($null -ne $edit -and -not $edit.Current.IsOffscreen) { return $edit }
        $comboValue = $null
        if ($combo.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$comboValue)) { return $combo }
    }
    return $null
}

Assert-DialogOwner
if ($Action -eq 'inspect') {
    @{ desktopPid = $DesktopPid; dialogTitle = $DialogTitle; controls = @(Get-ScopedControlSummary);
        nativeControls = @([AgentBayDialogWindow]::Controls($dialogHandle, [uint32]$DesktopPid)) } | ConvertTo-Json -Depth 4 -Compress
    exit 0
} elseif ($Action -eq 'cancel') {
    $cancel = Find-DialogControl '2' ([System.Windows.Automation.ControlType]::Button)
    if ($null -ne $cancel) {
        $pattern = $null
        if ($cancel.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
            $pattern.Invoke()
        } else {
            Assert-DialogOwner
            if (-not [AgentBayDialogWindow]::PostMessage($dialogHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) {
                throw 'Could not close the selected native dialog.'
            }
        }
    } else {
        if (-not [AgentBayDialogWindow]::PostMessage($dialogHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) {
            throw 'Could not close the selected native dialog.'
        }
    }
} else {
    $controlDeadline = [DateTime]::UtcNow.AddSeconds(5)
    $filename = $null
    while ([DateTime]::UtcNow -lt $controlDeadline) {
        Assert-DialogOwner
        $filename = Find-FilenameControl
        if ($null -ne $filename) { break }
        # Windows 11 can omit the filename edit from UIA while its scoped native
        # HWND is ready. Do not spend the UIA timeout waiting for that provider.
        if ([AgentBayDialogWindow]::FilenameEdit($dialogHandle, [uint32]$DesktopPid, ($Kind -eq 'folder'), ($Kind -eq 'save')) -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 100
    }
    if ($null -eq $filename) {
        $nativeEdit = [AgentBayDialogWindow]::FilenameEdit($dialogHandle, [uint32]$DesktopPid, ($Kind -eq 'folder'), ($Kind -eq 'save'))
        if ($nativeEdit -eq [IntPtr]::Zero) {
            $diagnostic = @{ controls = @(Get-ScopedControlSummary);
                nativeControls = @([AgentBayDialogWindow]::Controls($dialogHandle, [uint32]$DesktopPid)) }
            [Console]::Error.WriteLine('Scoped native dialog controls: ' + ($diagnostic | ConvertTo-Json -Depth 4 -Compress))
            throw 'The scoped dialog has no supported filename edit control (file host 1148, folder 1152, or unique save 1001).'
        }
        Assert-DialogOwner
        if (-not [AgentBayDialogWindow]::SetFilename($dialogHandle, $nativeEdit, [uint32]$DesktopPid, $Path)) {
            throw 'Could not set the scoped native filename edit control.'
        }
        Assert-DialogOwner
        if (-not [AgentBayDialogWindow]::Confirm($dialogHandle, [uint32]$DesktopPid)) {
            throw 'Could not invoke the scoped native primary button (ID 1).'
        }
    } else {
        $value = $null
        if (-not $filename.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$value)) {
            throw 'The scoped filename control does not support ValuePattern.'
        }
        Assert-DialogOwner
        $value.SetValue($Path)
        $confirm = Find-DialogControl '1' ([System.Windows.Automation.ControlType]::Button)
        if ($null -eq $confirm) { throw 'The scoped dialog has no primary action button (ID 1).' }
        $invoke = $null
        if (-not $confirm.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
            throw 'The scoped primary action button does not support InvokePattern.'
        }
        Assert-DialogOwner
        $invoke.Invoke()
    }
}

$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
while ([DateTime]::UtcNow -lt $deadline) {
    if (-not [AgentBayDialogWindow]::Matches($dialogHandle, [uint32]$DesktopPid, $DialogTitle)) {
        @{ passed = $true; action = $Action; kind = $Kind; desktopPid = $DesktopPid; dialogTitle = $DialogTitle; path = $(if ($Action -eq 'choose') { $Path } else { $null }) } | ConvertTo-Json -Compress
        exit 0
    }
    Start-Sleep -Milliseconds 100
}
throw 'The scoped native dialog did not close. No overwrite confirmation or other dialog was accepted.'
