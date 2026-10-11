// Chromium 53 (webOS TV 4.x) has no #RRGGBBAA / #RGBA colors (Chrome 62+): a style with one is
// dropped. cssColor() gives the same color as rgba(), and leaves any other value as it is (F4.1b:
// the subtitle color buttons of Settings came out empty).

const cssColor = (value) => {
    if (typeof value !== 'string') return value;
    const match = /^#([0-9a-f]{4}|[0-9a-f]{8})$/i.exec(value.trim());
    if (!match) return value;
    const hex = match[1].length === 4 ? match[1].replace(/./g, (digit) => digit + digit) : match[1];
    const [r, g, b, a] = [0, 2, 4, 6].map((index) => parseInt(hex.slice(index, index + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;
};

module.exports = { cssColor };
