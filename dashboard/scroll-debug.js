// Run this in browser console to debug scroll issues
(function() {
  console.log('=== SCROLL DEBUG ===');

  function checkElement(el, depth = 0) {
    const indent = '  '.repeat(depth);
    const computed = window.getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const classes = el.className ? `.${el.className.split(' ').join('.')}` : '';

    const overflowY = computed.overflowY;
    const overflowX = computed.overflowX;
    const height = computed.height;
    const position = computed.position;

    const hasHiddenOverflow = overflowY === 'hidden' || overflowX === 'hidden';

    if (hasHiddenOverflow || position === 'fixed' || height === '100vh') {
      console.log(
        `${indent}${tag}${id}${classes}`,
        `| overflowY: ${overflowY}`,
        `| overflowX: ${overflowX}`,
        `| height: ${height}`,
        `| position: ${position}`
      );
    }

    // Check children
    Array.from(el.children).forEach(child => {
      if (depth < 10) { // limit depth
        checkElement(child, depth + 1);
      }
    });
  }

  console.log('Elements with overflow:hidden or fixed position:');
  checkElement(document.documentElement);

  console.log('\n=== BODY SCROLL INFO ===');
  console.log('body scrollHeight:', document.body.scrollHeight);
  console.log('body clientHeight:', document.body.clientHeight);
  console.log('body offsetHeight:', document.body.offsetHeight);
  console.log('body overflow:', window.getComputedStyle(document.body).overflow);
  console.log('html overflow:', window.getComputedStyle(document.documentElement).overflow);
})();
