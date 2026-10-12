// Инициалы по первым буквам слов: «Дмитрий Соколов» и «И. Крылов» → «ДС» и «ИК»,
// одно слово → первые две буквы. Совпадает с плитками рейтинга и концепта.
export const initials = (name: string) => {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const letters =
    words.length > 1
      ? words
          .slice(0, 2)
          .map((word) => word[0])
          .join("")
      : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
};
