import { createTheme, type MantineColorsTuple } from '@mantine/core';

// "Informe del mes": the household read like a statistical release, dressed in the
// early-2010s web the users asked for: navy rail, dark top bar with divided tabs, boxed
// panels with gradient title bars, square corners, buttons with a little depth.
// Ocre is reserved for CPI-adjusted ("real") figures and series.

const navy: MantineColorsTuple = ['#edf2f8', '#d8e2ee', '#b0c3dc', '#85a3c9', '#6188b9', '#4a77af', '#3d6ba6', '#2e5a91', '#244e80', '#163f6e'];
const ocre: MantineColorsTuple = ['#fdf3e7', '#f8e3c8', '#f0c68e', '#e8a853', '#e18f28', '#dc7f12', '#c96f08', '#a85b05', '#8c4b03', '#703b00'];
// Cool blue-grey neutrals instead of Mantine's warm-ish greys.
const gray: MantineColorsTuple = ['#f5f7fa', '#edf0f5', '#e1e6ee', '#ccd4e0', '#a8b3c4', '#8490a5', '#5f6b80', '#475268', '#323c4f', '#1f2736'];
// Decorative colors (categories, accounts, goals, chart series) are remapped into one
// statistical family so identity never competes with ocre (real) or green/red (signed change).
// red, yellow and teal stay semantic: errors, warnings and good/up.
function family(base: [number, number, number]): MantineColorsTuple {
  const mix = (t: number, to: number) => base.map((c) => Math.round(c + (to - c) * t));
  const hex = (rgb: number[]) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  const light = [0.92, 0.8, 0.62, 0.44, 0.26, 0.12].map((t) => hex(mix(t, 255)));
  const darkSteps = [0, 0.16, 0.3, 0.44].map((t) => hex(mix(t, 0)));
  return [...light, ...darkSteps] as unknown as MantineColorsTuple;
}
const series = {
  indigo: family([36, 80, 138]),
  blue: family([58, 120, 194]),
  cyan: family([42, 146, 170]),
  green: family([62, 132, 150]),
  lime: family([104, 150, 176]),
  orange: family([84, 104, 160]),
  pink: family([118, 136, 184]),
  grape: family([92, 94, 158]),
  violet: family([70, 76, 140]),
};

const dark: MantineColorsTuple = ['#c8d0dc', '#a6b0c0', '#7c879a', '#5a6578', '#3c4657', '#2b3443', '#1f2733', '#171e28', '#11171f', '#0b1016'];

export const theme = createTheme({
  primaryColor: 'navy',
  primaryShade: { light: 8, dark: 4 },
  colors: { navy, ocre, gray, dark, ...series },
  // Source Sans 3: the open-source cousin of Myriad, the face of the early-2010s Apple Store.
  fontFamily: "'Source Sans 3 Variable', 'Source Sans 3', 'Myriad Pro', system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontFamilyMonospace: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  headings: {
    fontFamily: "'Source Sans 3 Variable', 'Source Sans 3', 'Myriad Pro', system-ui, sans-serif",
    fontWeight: '700',
    sizes: {
      h1: { fontSize: '1.625rem', lineHeight: '1.2' },
      h2: { fontSize: '1.375rem', lineHeight: '1.25' },
      h3: { fontSize: '1.125rem', lineHeight: '1.3' },
      h4: { fontSize: '1rem', lineHeight: '1.35' },
      h5: { fontSize: '0.9375rem', lineHeight: '1.35' },
    },
  },
  // Boxed, early-2010s: corners are square; nothing is prominently rounded.
  radius: { xs: '0px', sm: '1px', md: '2px', lg: '2px', xl: '2px' },
  defaultRadius: 'sm',
  shadows: {
    xs: '0 1px 2px rgba(15, 42, 74, 0.08)',
    sm: '0 2px 6px rgba(15, 42, 74, 0.12)',
    md: '0 4px 12px rgba(15, 42, 74, 0.14)',
    lg: '0 8px 24px rgba(15, 42, 74, 0.16)',
    xl: '0 12px 32px rgba(15, 42, 74, 0.18)',
  },
  components: {
    Card: { defaultProps: { withBorder: true, radius: 0, padding: 'md', shadow: 'none' } },
    Paper: { defaultProps: { radius: 0 } },
    Badge: { defaultProps: { radius: 'xs' }, styles: { root: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 } } },
    Avatar: { defaultProps: { radius: 1000 } },
    Switch: { defaultProps: { radius: 2 } },
    Indicator: { defaultProps: { radius: 1000 } },
    Popover: { defaultProps: { shadow: 'md', radius: 'sm' } },
    Menu: { defaultProps: { shadow: 'md', radius: 'sm' } },
    Modal: { defaultProps: { radius: 0, overlayProps: { backgroundOpacity: 0.45, color: '#0b1a2e' } } },
    Tooltip: { defaultProps: { radius: 'sm' } },
    Table: { defaultProps: { verticalSpacing: 8 } },
    Tabs: { defaultProps: { variant: 'outline', radius: 0 } },
    Pagination: { defaultProps: { radius: 0 } },
  },
});
