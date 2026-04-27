---
id: accessibility-wcag
name: Accessibility WCAG
audience: [frontend-ux-engineering]
priority: 72
trigger:
  stages: [FRONTEND_BUILD, VERIFY]
  keywords: [accessibility, keyboard, mobile, form]
---

# Accessibility WCAG

Purpose: Make operator workflows usable by keyboard and screen readers.

1. Use native buttons, labels, selects, and details.
2. Preserve visible focus states.
3. Keep text readable at small widths.
4. Use status text, not color alone.

Checklist:

- Inputs have labels.
- Button text names the action.
- Focus is visible.
- Contrast is sufficient.

Positive example: emergency stop has text and status color.
Negative example: icon-only unlabeled critical action.

Failure modes: color-only state, clipped text, unreachable controls.
