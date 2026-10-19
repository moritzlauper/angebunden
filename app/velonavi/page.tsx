/**
 * Der Velonavi liegt seit der Umstellung auf der Startseite. Diese Adresse
 * leitet über next.config.ts dauerhaft auf «/» weiter. Für den statischen
 * Export bleibt dieser Alias mit canonical «/», damit geteilte Links auch
 * ohne Server-Weiterleitung funktionieren.
 */
export { default, metadata } from '../page'
