const themeDict = {
    "DarkSky": {
        "bg": "--palette1-bg",
        "text": "--palette1-text",
        "title": "My Pastebin 🌙🌌"
    },
    "DeepOcean": {
        "bg": "--palette3-bg",
        "text": "--palette3-text",
        "title": "My Pastebin 🌊"
    }
};


$(document).ready(function () {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        applyTheme(savedTheme);
    }
});
$('.palette-dropdown').on('change', function () {
    const selectedTheme = $(this).val();
    if (selectedTheme !== localStorage.getItem('theme')) {
        applyTheme(selectedTheme);
        localStorage.setItem('theme', selectedTheme);
    }
});
function applyTheme(theme) {
    if (!themeDict[theme]) return;
    const root = document.documentElement;
    $('.palette-dropdown').val(theme);
    root.style.setProperty('--dynamic-bg', getComputedStyle(root).getPropertyValue(themeDict[theme].bg));
    root.style.setProperty('--dynamic-text', getComputedStyle(root).getPropertyValue(themeDict[theme].text));
    $('body').css({
        'background': 'var(--dynamic-bg)',
        'color': 'var(--dynamic-text)'
    });
    updateTitle(theme);
}
function updateTitle(theme) {
    if (document.title !== themeDict[theme].title) {
        document.title = themeDict[theme].title;
    }
}
