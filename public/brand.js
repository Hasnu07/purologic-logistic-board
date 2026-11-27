// The accessory ticks on the shipment form follow the brand: pick Rolex and you get Rolex's list.
// What was already ticked stays ticked if the new list has it, so changing brand loses nothing.
(function () {
  var MAP = window.__BRAND_ACC || {};
  var form = document.getElementById('shipform');
  if (!form) return;

  function rebuild(select) {
    var block = select.closest('[data-block]');
    if (!block) return;
    var box = block.querySelector('[data-acc]');
    if (!box) return;
    var i = block.dataset.i || '0';
    var ticked = {};
    box.querySelectorAll('input[type=checkbox]').forEach(function (c) { if (c.checked) ticked[c.value] = true; });

    var list = MAP[select.value] || MAP[''] || [];
    box.textContent = '';
    list.forEach(function (label) {
      var l = document.createElement('label');
      var c = document.createElement('input');
      c.type = 'checkbox';
      c.name = 'acc_' + i;
      c.value = label;
      c.checked = !!ticked[label];
      l.appendChild(c);
      l.appendChild(document.createTextNode(label));
      box.appendChild(l);
    });

    // Anything that was ticked but is not on the new brand's list moves into the free-text field,
    // so nothing the staff recorded is thrown away by changing the brand.
    var leftover = Object.keys(ticked).filter(function (k) { return list.indexOf(k) === -1; });
    var other = block.querySelector('[name^="acc_other_"]');
    if (other && leftover.length) {
      var have = other.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      leftover.forEach(function (k) { if (have.indexOf(k) === -1) have.push(k); });
      other.value = have.join(', ');
    }
  }

  form.addEventListener('change', function (e) {
    if (e.target.matches('[data-brand]')) rebuild(e.target);
  });
})();
