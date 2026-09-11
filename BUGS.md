# Bugs

- **ISSUE:** In the rail layout, `FilterBar`'s `FilterPopover` opens as an
  anchored `absolute` panel that gets clipped by the window edge in a narrow
  docked window.
  **SOLUTION:** Below the rail breakpoint, render it as a portalled, vertically
  centred modal dialog instead of an anchored popover; dismiss on backdrop click
  or Escape.
