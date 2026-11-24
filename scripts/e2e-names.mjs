// [MEAL-27-f] A run's tag for the made-up names an e2e spec gives what it adds (WP-125). Letters only:
// a tag with digits can read as an amount where a grocery name ends ("Quince e2e 333kg" is saved
// whole when typed as "2 lb Quince e2e 333kg", then keyed "quince e2e", 333 kg taken off as its
// amount), and a name led by an amount the spec typed must key the same as the name it was saved as.

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** `length` random lowercase letters (5 by default). `random` is for tests. */
export function nameTag(length = 5, random = Math.random) {
  let tag = '';
  for (let i = 0; i < length; i += 1) tag += LETTERS[Math.floor(random() * LETTERS.length)];
  return tag;
}
