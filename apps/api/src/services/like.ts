// Prisma passes `contains` to (I)LIKE unescaped, so % and _ would act as wildcards.
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);
