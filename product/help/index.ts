export { ARTICLES } from "./articles";
export type { Article, Localized } from "./articles";
import { ARTICLES } from "./articles";
export const findArticle = (id?: string) => ARTICLES.find((a) => a.id === id);
