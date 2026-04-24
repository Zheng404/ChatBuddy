/**
 * Layout-related event listeners (tab scrolling, workspace responsive).
 */
export function getLayoutJs(): string {
  return `
      // Tab scroll arrows
      (function() {
        var tabs = document.getElementById('settingsTabs');
        var arrowL = document.getElementById('tabArrowLeft');
        var arrowR = document.getElementById('tabArrowRight');
        if (!tabs || !arrowL || !arrowR) return;

        function update() {
          var hasOverflow = tabs.scrollWidth > tabs.clientWidth + 2;
          arrowL.classList.toggle('visible', hasOverflow && tabs.scrollLeft > 2);
          arrowR.classList.toggle('visible', hasOverflow && tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 2);
        }

        arrowL.addEventListener('click', function() {
          tabs.scrollBy({ left: -120 });
          setTimeout(update, 200);
        });
        arrowR.addEventListener('click', function() {
          tabs.scrollBy({ left: 120 });
          setTimeout(update, 200);
        });
        tabs.addEventListener('scroll', update);
        window.addEventListener('resize', update);
        setTimeout(update, 100);
        setTimeout(update, 500);
        if (typeof ResizeObserver !== 'undefined') {
          new ResizeObserver(update).observe(tabs);
        }
      })();

      // Provider workspace responsive layout
      var refreshWorkspaceLayout;
      (function() {
        refreshWorkspaceLayout = function() {
          var ws = document.querySelector('.provider-workspace');
          if (!ws) return;
          ws.classList.toggle('stacked', ws.clientWidth < 600);
        };
        window.addEventListener('resize', refreshWorkspaceLayout);
        setTimeout(refreshWorkspaceLayout, 100);
        if (typeof ResizeObserver !== 'undefined') {
          var ws = document.querySelector('.provider-workspace');
          if (ws) new ResizeObserver(refreshWorkspaceLayout).observe(ws);
        }
      })();
`;
}
