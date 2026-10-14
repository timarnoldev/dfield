# DFIELD – Web

Touch-friendly web port of **DFIELD 2014.08b** (John C. Polking, Joel Castellanos), the
interactive direction field and solution plotter for first-order ODEs `x' = f(t,x)`.

Live: https://dfield.tim-arnold.de

- Same expression syntax, ODE solvers (Euler, RK2, RK4, Runge-Kutta-Fehlberg, Dormand-Prince
  with dense output), direction field, gallery, zoom history, text annotations and `dfield.ini`
  preferences format as the original Java application.
- Optimised for iPad: tap to plot a solution, drag a rectangle to zoom, pinch to zoom/pan,
  large touch targets, can be added to the home screen.
- Plain HTML/CSS/JavaScript, no build step. Run locally with `python3 -m http.server`.
