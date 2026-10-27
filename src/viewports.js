// src/viewports.js
//
// Each device's REAL screen size, not just its width. The height matters as
// much as the width: a hero built with `min-height: 100vh` is exactly as tall
// as the viewport it is rendered in, so capturing every device at one fixed
// height made the phone's hero 1000px tall where a real iPhone gives it 848px.
// Scaled into the phone frame, that taller hero pushed the site's content down
// and opened a gap under the header that the real device does not have.
//
// These are the same four screens public/style.css and src/composite.js frame:
//
//   desktop  Studio Display 27"  16:9       -> 1920x1080
//   laptop   MacBook Pro 14"     3024x1964  -> 1440x936
//   tablet   iPad Pro 11"         834x1210  ->  768x1114
//   mobile   iPhone 16 Pro        402x874   ->  390x848
//
// The phone's height here is its 848px screen MINUS the 59px status bar,
// because the status bar is not part of the web viewport — the device frames
// draw that strip themselves, above the screenshot. Capturing the full 848 and
// then adding the strip counted the inset twice: the image came out taller
// than the space it goes into, so it was pushed down and its bottom cropped.
// 789 + 59 lands exactly on the 848 screen the frame draws.
const MOBILE_STATUS_BAR = 59;

export const VIEWPORTS = [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'laptop', width: 1440, height: 936 },
  { name: 'tablet', width: 768, height: 1114 },
  { name: 'mobile', width: 390, height: 848 - MOBILE_STATUS_BAR },
];
