/**
 * QZ Tray Connector - Minimal loader
 * Loads QZ Tray library from CDN
 */

(function() {
    if (typeof qz !== 'undefined') return;
    
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.min.js';
    script.onload = function() {
        console.log('QZ Tray library loaded');
    };
    document.head.appendChild(script);
})();
