// Tailwind is compiled ahead of time for TILT.html and the standalone
// bundle - no Play CDN at runtime. darkMode must stay 'class': the editor
// flips .dark on <html>, and the media default would ignore it.
module.exports = {
    darkMode: 'class',
    theme: { extend: {} },
    plugins: [],
    content: ['./TILT.html', './js/**/*.js']
};
