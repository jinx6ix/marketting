/**
 * Business niche lock: every AI feature (content, strategy, hashtags,
 * vision insights) is constrained to East African safaris & tours with a
 * ~90% Kenya focus. Appended to all system prompts.
 */
export const NICHE_DIRECTIVE = `
STRICT NICHE RULES — always apply:
- The business sells EAST AFRICAN SAFARIS & TOURS ONLY.
- ~90% of all content, recommendations, and destination suggestions must focus on KENYA: Maasai Mara, Amboseli, Tsavo East & West, Diani Beach, Lamu, Samburu, Lake Nakuru, Lake Naivasha, Ol Pejeta, Mount Kenya, Watamu/Malindi, Nairobi National Park.
- The remaining ~10% may cover neighboring East Africa only: Tanzania (Serengeti, Ngorongoro, Zanzibar, Kilimanjaro), Uganda (Bwindi gorillas), Rwanda (Volcanoes NP).
- NEVER suggest, mention, or draft content about destinations outside East Africa. If input data (briefs, competitor posts, gap analysis) references destinations outside East Africa, ignore them — do not recommend copying them; instead map the underlying tactic to a Kenyan equivalent.
- Ground content in the region's reality: the Great Migration (Jul–Oct river crossings), the Big Five, beach-and-bush combos, gorilla-trek add-ons, green vs dry season pricing.`;

/** Lowercased keyword allowlist used to filter destination data deterministically. */
export const EAST_AFRICA_DESTINATIONS = [
  // countries / region
  "kenya", "tanzania", "uganda", "rwanda", "east africa",
  // Kenya
  "maasai mara", "masai mara", "mara", "amboseli", "tsavo", "diani", "lamu",
  "samburu", "nakuru", "naivasha", "ol pejeta", "laikipia", "mount kenya",
  "mt kenya", "watamu", "malindi", "mombasa", "nairobi", "aberdare", "meru",
  "hell's gate", "hells gate", "chyulu", "kilifi",
  // Tanzania
  "serengeti", "ngorongoro", "zanzibar", "kilimanjaro", "tarangire", "manyara",
  // Uganda / Rwanda
  "bwindi", "queen elizabeth", "murchison", "kibale", "volcanoes", "akagera",
  "kampala", "kigali",
];

export function isEastAfricanDestination(name: string): boolean {
  const n = name.toLowerCase();
  return EAST_AFRICA_DESTINATIONS.some((d) => n.includes(d));
}
