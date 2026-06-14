/**
 * 插值模板：把 `{{var}}` 替换为 values[var]，未提供的占位符保留原样。
 *
 * 不匹配 `{var}`、`${var}`、`{{ var }}`（带空格）等其他语法。
 */
export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
  });
}
