export const colorForPercent = (percent: number) => {
    const clamped = Math.max(0, Math.min(100, percent));
    const hue = (clamped / 100) * 120;
    const lightness = Math.max(25, 65 - clamped * 0.25);
    return `hsl(${Math.round(hue)}, 70%, ${Math.round(lightness)}%)`;
};
