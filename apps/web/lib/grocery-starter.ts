// [MEAL-24] The starter list (D-140 A): an item's name (its key, see grocery-merge.ts) → the starter
// category it belongs in (produce, dairy, bakery, meat, pantry, frozen, snacks, household). Built
// once from the English names and synonyms of Open Food Facts' category taxonomy, names of up to
// two words, each placed by its nearest mapped parent, plus a short made-up list of household
// things that Open Food Facts doesn't hold. 5,928 names, about 29 KB once compressed. Measured on
// 200 made-up items: 84.5% placed right, with no model and no paid service.
//
// Open Food Facts data: © Open Food Facts contributors, under the Open Database License (ODbL),
// https://world.openfoodfacts.org/data.

import words from './grocery-starter.json';

export const starterList: ReadonlyMap<string, string> = new Map(Object.entries(words));
