/**
 * Der Velonavi liegt seit der Umstellung auf der Startseite. Diese Adresse
 * bleibt als Alias bestehen, damit geteilte Links weiter funktionieren; die
 * canonical-Angabe zeigt auf «/». Bei einem statischen Export lassen sich
 * keine Weiterleitungen einrichten, deshalb ein Alias statt eines Redirects.
 */
export { default, metadata } from '../page'
