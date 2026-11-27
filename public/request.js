// The client's New shipment page: shows the questions that match collection or delivery,
// and keeps the total declared value in step with the watches on the form.
(function () {
  var form = document.getElementById('reqform');
  if (!form) return;

  function showKind() {
    var picked = form.querySelector('[data-kind]:checked');
    var kind = picked ? picked.value : 'collection';
    document.querySelectorAll('[data-when]').forEach(function (el) {
      var on = el.dataset.when === kind;
      el.hidden = !on;
      // A hidden question must not block the form or be sent.
      el.querySelectorAll('input, textarea, select').forEach(function (f) { f.disabled = !on; });
    });
  }

  function total() {
    var sum = 0, n = 0, any = false;
    form.querySelectorAll('[data-value]').forEach(function (el) {
      n++;
      var v = parseFloat(el.value);
      if (!isNaN(v) && v >= 0) { sum += v; any = true; }
    });
    var box = document.querySelector('[data-total]');
    var count = document.querySelector('[data-count]');
    if (count) count.textContent = String(n);
    if (!box) return;
    box.textContent = any
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: box.dataset.cur || 'USD', maximumFractionDigits: 0 }).format(sum)
      : '—';
  }

  form.addEventListener('change', function (e) {
    if (e.target.matches('[data-kind]')) showKind();
    total();
  });
  form.addEventListener('input', total);
  // form.js may add or remove a watch block after this runs.
  new MutationObserver(total).observe(form, { childList: true, subtree: true });

  showKind();
  total();
})();
