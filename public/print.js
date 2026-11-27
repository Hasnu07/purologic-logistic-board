// Print sheet: the Print button, and the automatic print dialog when opened with ?auto=1.
document.querySelectorAll('[data-print]').forEach(function (b) {
  b.addEventListener('click', function () { window.print(); });
});
if (document.body.dataset.auto === '1') {
  window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });
}
