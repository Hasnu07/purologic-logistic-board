// Repeatable blocks on a form: the "add another watch" button on the shipment form and on the
// client's collection request. Every field inside a block is numbered (watch_0, watch_1, ...),
// so the server can read the blocks back without guessing which value belongs to which watch.
(function () {
  function fields(root) {
    return root.querySelectorAll('[name], [id], [for], [data-n]');
  }

  // Puts the block at position `n`: every name, id and label points at the same number again.
  function renumber(block, n) {
    block.dataset.i = String(n);
    fields(block).forEach(function (el) {
      ['name', 'id', 'for'].forEach(function (attr) {
        var v = el.getAttribute && el.getAttribute(attr);
        if (v) el.setAttribute(attr, v.replace(/_\d+$|_i$/, '_' + n).replace(/__N__/g, n));
      });
      if (el.hasAttribute && el.hasAttribute('data-n')) el.textContent = String(n + 1);
    });
  }

  function wire(list) {
    var blocks = list.querySelectorAll('[data-block]');
    blocks.forEach(function (b, i) { renumber(b, i); });
    blocks.forEach(function (b) {
      var x = b.querySelector('[data-remove]');
      if (x) x.hidden = blocks.length < 2;
    });
  }

  document.querySelectorAll('[data-repeat]').forEach(function (list) {
    var tplHtml = list.querySelector('[data-block]').outerHTML;

    list.addEventListener('click', function (e) {
      var x = e.target.closest('[data-remove]');
      if (!x) return;
      e.preventDefault();
      var block = x.closest('[data-block]');
      if (list.querySelectorAll('[data-block]').length > 1) block.remove();
      wire(list);
    });

    var add = document.querySelector('[data-add="' + list.dataset.repeat + '"]');
    if (add) add.addEventListener('click', function (e) {
      e.preventDefault();
      var holder = document.createElement('div');
      holder.innerHTML = tplHtml;
      var block = holder.firstElementChild;
      // A new block starts empty: it is a different watch, not a copy of the one above.
      block.querySelectorAll('input, textarea, select').forEach(function (el) {
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
        else if (el.type !== 'button' && el.type !== 'submit') el.value = '';
      });
      list.appendChild(block);
      wire(list);
      var first = block.querySelector('input:not([type=hidden])');
      if (first) first.focus();
    });

    wire(list);
  });
})();
