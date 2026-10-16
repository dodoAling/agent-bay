window.showDesktopFailure = message => {
  document.body.dataset.state = 'failed';
  document.querySelector('#status').textContent = 'The local runtime could not start.';
  const error = document.querySelector('#error');
  error.hidden = false; error.textContent = String(message);
};
document.querySelector('#boot-close').onclick = () => window.__TAURI__?.window.getCurrentWindow().close();
