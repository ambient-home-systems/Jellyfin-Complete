// Small progressive enhancements (ADR-046). Every page works without this file: tabs are plain links, the Inbox's
// checkboxes still submit, and forms save the same way. With it, tabs switch without losing what you typed, and
// "select all" boxes appear.
(function () {
  'use strict';

  // Things that only make sense with scripting on, and the plain text they replace.
  function reveal(root) {
    root.querySelectorAll('.js-only[hidden]').forEach(function (el) { el.hidden = false; });
    root.querySelectorAll('.no-js').forEach(function (el) { el.hidden = true; });
  }

  // Tabs: show one panel, keep the others (and their form fields) on the page.
  function showTab(nav, name) {
    var known = false;
    nav.querySelectorAll('a[data-tab]').forEach(function (a) {
      var on = a.getAttribute('data-tab') === name;
      if (on) { a.setAttribute('aria-current', 'page'); known = true; } else a.removeAttribute('aria-current');
    });
    if (!known) return;
    document.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== name; });
    document.querySelectorAll('[data-tab-field]').forEach(function (f) { f.value = name; });
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-tabs] a[data-tab]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    showTab(a.closest('[data-tabs]'), a.getAttribute('data-tab'));
    history.replaceState(null, '', a.getAttribute('href'));
  });

  // A field that fails its check on a hidden tab can't be focused: open its tab first.
  document.addEventListener('invalid', function (e) {
    var panel = e.target.closest && e.target.closest('[data-panel]');
    var nav = document.querySelector('[data-tabs]');
    if (panel && panel.hidden && nav) showTab(nav, panel.getAttribute('data-panel'));
  }, true);

  // "Unsaved changes" beside Save, and a warning before leaving with edits.
  var dirty = false;
  document.addEventListener('input', function (e) {
    var form = e.target.form || (e.target.closest && e.target.closest('form'));
    if (!form || !form.hasAttribute('data-dirty')) return;
    var flag = document.querySelector(form.getAttribute('data-dirty'));
    if (flag) flag.hidden = false;
    dirty = true;
  });
  document.addEventListener('submit', function () { dirty = false; });
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // Select all, and select one collection's changes.
  function boxes(name, group) {
    return Array.prototype.filter.call(document.querySelectorAll('input[type="checkbox"][name="' + name + '"]'), function (b) {
      return !group || b.getAttribute('data-group') === group;
    });
  }
  function syncChecks() {
    document.querySelectorAll('[data-check-all]').forEach(function (all) {
      var list = boxes(all.getAttribute('data-check-all'));
      var on = list.filter(function (b) { return b.checked; }).length;
      all.checked = list.length > 0 && on === list.length;
      all.indeterminate = on > 0 && on < list.length;
    });
    document.querySelectorAll('[data-check-group]').forEach(function (g) {
      var list = boxes('ids', g.getAttribute('data-check-group'));
      var on = list.filter(function (b) { return b.checked; }).length;
      g.checked = list.length > 0 && on === list.length;
      g.indeterminate = on > 0 && on < list.length;
    });
  }
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || t.type !== 'checkbox') return;
    if (t.hasAttribute('data-check-all')) boxes(t.getAttribute('data-check-all')).forEach(function (b) { b.checked = t.checked; });
    else if (t.hasAttribute('data-check-group')) boxes('ids', t.getAttribute('data-check-group')).forEach(function (b) { b.checked = t.checked; });
    else if (t.name !== 'ids') return;
    syncChecks();
  });

  function start() { reveal(document); syncChecks(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  // Pages that refresh a part of themselves (htmx) get the same treatment for the new part.
  document.addEventListener('htmx:afterSwap', start);
})();
