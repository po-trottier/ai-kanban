/** Joins conditional class names (CSS-module lookups are `string | undefined`). */
export function cx(...classNames: (string | false | undefined)[]): string {
  return classNames
    .filter((name): name is string => typeof name === 'string' && name !== '')
    .join(' ')
}
