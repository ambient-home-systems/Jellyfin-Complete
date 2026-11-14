# Poster artwork brief

The brief the presets' own poster artwork (ADR-045) was made from, as given to the image-generation session. The finished art is in `assets/posters/art`, and the prompts used for each image are in [PROMPTS.txt](PROMPTS.txt). To add or redo a poster, follow this brief, keep the file name, and raise `BUNDLED_POSTERS_REV` in `src/posters/catalog.ts`.

---

You're making original poster artwork for an open-source home media app. The app builds automatic collections in Jellyfin (a home media server), such as "Christmas Movies" or "Recently Added Movies". Each collection shows as a portrait poster in a row on the home screen, next to real film posters, on TVs, phones and tablets. I need one finished artwork per collection, all in one consistent house style, so the row looks like a designed set.

## Before you start

- You must generate real raster images with an image-generation tool. If this session can't generate images, stop and tell me. Don't draw them with SVG, HTML, canvas or any other code.
- Make one image per generation. Don't put several posters in one image, and don't add mockup frames.
- Work in this order:
  1. Make the three style-test images marked ★ first: `seasonal-christmas`, `seasonal-halloween` and `basic-recently-added`.
  2. Show them to me and stop. Wait for my OK on the style before making the rest.
  3. Once I approve, use those three as style references for every other image, if your tool accepts reference images.
  4. Make the rest in batches of about five.
- Name every image exactly as given (for example `seasonal-christmas.png`). If your tool can't set file names, put the file name as the first line of the caption under each image, so I can save it correctly.
- At the end, list every file name you made, and any you couldn't make.

## Format (every image)

- **Shape:** portrait, exactly 2:3.
- **Size:** 1024 × 1536 or larger (2000 × 3000 is ideal). If your tool offers fixed sizes, pick the 2:3 portrait one.
- **File:** PNG, sRGB.
- **Edges:** full-bleed artwork to every edge. No border, frame, rounded corners, drop shadow, white margin, or picture-on-a-wall mockup.
- **Safe margin:** keep anything important at least 6% in from every edge. Some apps round the corners or crop slightly.

## No text at all

**The images must contain no text of any kind.** That means no:

- letters, words or numbers
- titles or captions
- signatures or watermarks
- fake or gibberish lettering
- signs, marquees or labels with writing on them
- anything shaped like letters

The app adds the collection's title itself, in its own typeface, so it's always spelled right and matches across the set. Signs and marquees in a scene stay blank or glow without writing.

Check every image closely. If any letter-like marks appear, regenerate it.

## Leave the bottom third for the title

The app sets the title in bold, white, condensed capitals over the **bottom 32%** of the poster, on a soft dark gradient. So:

- Put the main subject in the **upper two-thirds**, centred or on a strong diagonal.
- Keep the **bottom third quiet**: the scene simply continues there (ground, water, table, snow, shadow) with low detail.
  - No faces, key objects or bright highlights there.
  - It should settle naturally into darker, simpler tones.
- The image must still look complete and intentional with the bottom third darkened.

## House style (every image)

- **Medium:** a modern **screen-printed travel poster** crossed with **painterly gouache**:
  - large flat shapes of colour, with soft painted gradients inside them
  - visible paper grain and fine print grain throughout
  - a subtle halftone texture in the shadows
  - no outlines and no cartoon ink lines

  Think of a beautifully printed mid-century travel or national-park poster, made today.
- **Not:** photorealism, 3D renders, glossy digital painting, anime or manga, flat vector clip-art, or watercolour washes.
- **Light:** one strong light source per image (the moon, a sunrise, a lamp, a screen glow), with warm rim light on the edges of shapes.
- **Depth:** three or four layered planes from front to back: a dark foreground silhouette, a mid-ground subject, a background sky or wall. This layering is the house signature; use it in every image.
- **Colour:**
  - Each image has its own palette (given below) of three or four main colours.
  - Every image also shares two colours: a warm cream for the brightest highlights (about #F4EBD9) and a deep blue-black ink for the darkest darks (about #14161C).
  - Keep saturation rich but not neon, except where noted.
- **Readability:** one clear focal subject with a strong silhouette, readable as a thumbnail about 150 pixels wide on a TV. Use plenty of negative space. Don't clutter.
- **People:**
  - Only as small or medium figures, seen from behind or in silhouette, with no detailed faces.
  - Show a natural mix of ages, body types and skin tones.
  - Never a real or famous person. Never a recognisable film or TV character.
- **Mood:** warm, inviting and cinematic.
- **Family-safe:** every poster appears on a home screen that children see. Keep everything G-rated: gentle, never frightening, never suggestive.

## Never include (every image)

- Any text, as above.
- Logos, brand names, trademarks or app icons. That includes streaming services, film studios, IMDb, awards bodies and products.
- Characters, costumes, vehicles, creatures or props from any specific film, show, game or book.
- Real people. Real landmarks that identify a single specific place (such as a famous skyline, bridge or building).
- A copy or close imitation of an existing poster, or the style of a named living artist.
- Nudity, suggestive poses, kissing close-ups, gore, blood, injuries, weapons, realistic skulls or bones, corpses, alcohol or drinking, smoking, or drugs.
- National flags, except the US flag where a brief says so.
- Religious symbols, except where a brief says so.
- Stereotypes or caricatures of any ethnicity, nationality, culture, religion, gender, sexuality, age or disability. That includes costume clichés (sombreros, conical hats, feathered headdresses, leprechauns) and pity or "inspiration" framing of disability.

## The images

Each entry gives the file name, the collection it's for, the subject, the palette and notes. Follow the subject closely. You choose the exact composition within the house style.

### Seasonal films (19)

1. **`seasonal-years.png`**: New Year's Day Movies
   - **Subject:** a city rooftop at midnight, fireworks bursting over an invented skyline of old brick towers and water towers, with two small silhouetted figures and a string of party lights along the rooftop rail.
   - **Palette:** midnight navy, champagne gold, a magenta spark.
   - **Mood:** fresh start, celebration.

2. **`seasonal-valentine.png`**: Valentine's Day Movies
   - **Subject:** a park path at dusk under an old iron streetlamp; two silhouettes walk away from us sharing one red umbrella while cherry petals drift down.
   - **Palette:** rose pink, deep crimson, dusky violet.
   - **Mood:** gentle and romantic; no kissing.

3. **`seasonal-patrick.png`**: St. Patrick's Day Movies
   - **Subject:** rolling emerald hills at golden hour, a winding dry-stone wall, a rainbow arcing down to a glint of light in the valley, and large shamrocks in the dark foreground.
   - **Palette:** emerald, moss, gold.
   - **Avoid:** leprechauns, beer, hats.

4. **`seasonal-easter.png`**: Easter Movies
   - **Subject:** a spring meadow at sunrise, a woven basket of pastel painted eggs among tulips and daffodils, and a rabbit's silhouette peeking from the long grass.
   - **Palette:** lilac, mint, butter yellow.
   - **Notes:** secular, no religious symbols.

5. **`seasonal-mother.png`**: Mother's Day Movies
   - **Subject:** a sunlit kitchen windowsill holding a hand-picked bouquet of peonies and tulips in a glass jar, with a garden beyond the window where a parent and small child, seen from behind, are watering flowers.
   - **Palette:** blush pink, sage, warm peach.

6. **`seasonal-memorial.png`**: Memorial Day Movies
   - **Subject:** a quiet green field at dawn with soft mist and rows of small US flags planted in the grass, receding into the distance. Red poppies fill the dark foreground.
   - **Palette:** muted navy, poppy red, dawn gold, stone grey.
   - **Mood:** solemn and dignified.
   - **Avoid:** soldiers, weapons, headstones, any real cemetery.

7. **`seasonal-father.png`**: Father's Day Movies
   - **Subject:** a wooden dock on a still lake at sunrise; a father and child, seen from behind, fish side by side, with a canoe tied alongside and pines on the far shore.
   - **Palette:** lake teal, sunrise orange, pine green.

8. **`seasonal-independence.png`**: Independence Day Movies
   - **Subject:** fireworks over a small lake at night, seen from a grassy hill where small silhouetted families wave sparklers. Red, white and blue bunting hangs from a gazebo. A US flag may hang from the gazebo.
   - **Palette:** navy, firework red, white-gold.

9. **`seasonal-labor.png`**: Labor Day Movies
   - **Subject:** an invented steel bridge under construction at golden hour; small silhouettes of workers in hard hats stand on the girders against big summer clouds; a checkered picnic blanket is in the foreground.
   - **Palette:** burnt orange, steel blue, sunflower yellow.
   - **Notes:** a tribute to working people.
   - **Avoid:** recreating any famous photograph.

10. **`seasonal-halloween.png`** ★: Halloween Movies
    - **Subject:** a crooked old house on a hilltop, one window glowing, under a huge harvest moon. Bats circle; a path lined with carved jack-o'-lanterns climbs to the door; a black cat sits on the fence in the foreground.
    - **Palette:** pumpkin orange, deep violet, midnight teal.
    - **Mood:** spooky-cosy, G-rated.
    - **Avoid:** skulls, gore, monsters, scary faces.

11. **`seasonal-veteran.png`**: Veterans Day Movies
    - **Subject:** a front porch at autumn dusk with a US flag on a pole by the door and warm light in the window. An older figure and a dog, seen from behind, sit on the porch steps as leaves fall.
    - **Palette:** autumn rust, navy, muted gold.
    - **Mood:** warm, homecoming, dignified.
    - **Avoid:** weapons, uniforms with insignia.

12. **`seasonal-thanksgiving.png`**: Thanksgiving Movies
    - **Subject:** a long farmhouse table set outdoors under a great oak at golden hour, with pies, a roast, gourds and candles. Autumn leaves drift down and the chairs wait, empty and inviting.
    - **Palette:** harvest orange, cranberry, olive.
    - **Avoid:** pilgrim or Native American imagery.

13. **`seasonal-christmas.png`** ★: Christmas Movies
    - **Subject:** a snow-covered cabin in a pine forest at blue hour. The windows glow warm, a decorated tree shows in the window, string lights run along the eaves, smoke curls from the chimney, a wooden sled leans by the door, and snow falls gently under a few stars.
    - **Palette:** deep spruce green, cranberry red, warm gold, snow blue-white.

14. **`seasonal-aapi.png`**: Asian American & Pacific Islander Heritage Month Movies
    - **Subject:** a celebratory evening where the Pacific meets a coastal city neighbourhood. In the foreground water, an outrigger canoe glides past. On the hillside, homes are strung with warm lights and flowering trees bloom. Small family silhouettes watch from a seawall.
    - **Palette:** ocean teal, sunset coral, blossom pink.
    - **Avoid:** conical hats, dragons, costumes, "oriental" motifs, any single nation's flag.

15. **`seasonal-disabilities.png`**: International Day of Persons with Disabilities Movies
    - **Subject:** a sunlit park path at sunrise; friends seen from behind head toward the light together. One uses a wheelchair, one walks with a guide dog, one with a cane, and kites fly overhead.
    - **Palette:** sky teal, sunrise apricot, leaf green.
    - **Mood:** joyful, ordinary and together.
    - **Avoid:** medical imagery, sadness, "inspiration" framing.

16. **`seasonal-black_history.png`**: Black History Month Movies
    - **Subject:** sunrise over a city seen from a hilltop. In the foreground, a family of silhouettes stands under a great tree in full leaf whose deep roots are visible in the hillside, looking toward the light.
    - **Palette:** deep indigo, sunrise gold, terracotta.
    - **Mood:** dignified, proud, hopeful.
    - **Avoid:** depicting real historical figures or events, stereotypes, any textile patterns from specific cultures.

17. **`seasonal-lgbtq.png`**: LGBTQ+ Pride Month Movies
    - **Subject:** a summer-evening street festival under a twilight sky. Rainbow paper lanterns and streamers are strung between buildings, confetti drifts, and a crowd of silhouettes, some holding hands, fills the street.
    - **Palette:** the six classic rainbow hues against twilight violet; brighter is fine here.
    - **Notes:** G-rated. Use the plain rainbow, not any specific variant flag design.

18. **`seasonal-latinx.png`**: Latinx Heritage Month Movies
    - **Subject:** a hillside town at golden hour with brightly painted houses and bougainvillea spilling over walls. Strings of cut-paper banners (blank, no lettering) hang across a plaza where silhouettes of musicians with guitars play for dancing families.
    - **Palette:** magenta, turquoise, marigold.
    - **Avoid:** sombreros, cacti clichés, skulls, any single nation's flag.

19. **`seasonal-women.png`**: Women's History Month Movies
    - **Subject:** three generations of women seen from behind (a grandmother, a mother and a girl) standing together on a hilltop at sunrise, looking out over a wide valley, with a winding path climbing behind them.
    - **Palette:** violet, sunrise coral, gold. (Violet, white and gold nod to the suffrage colours.)
    - **Avoid:** real historical figures.

### New and recent (3)

20. **`basic-new-releases.png`**: Newly Released Movies, and Newly Released Shows
    - **Subject:** premiere night outside an old movie palace. The marquee blazes with bulbs but is blank, with no letters. Two searchlight beams cross the night sky above it, and a red carpet runs out to the street where small silhouettes gather.
    - **Palette:** deep red, warm bulb gold, night blue.

21. **`basic-new-episodes.png`**: New Episodes
    - **Subject:** a cosy living room at night, seen from just behind a sofa with a knitted blanket over its back. A cat curls on the armrest and a bowl of popcorn sits on the cushion. The room is lit by the glow of a TV screen that shows only soft abstract light, no picture.
    - **Palette:** screen cyan-blue glow, warm lamp amber, deep navy.

22. **`basic-recently-added.png`** ★: Recently Added Movies, and Recently Added Shows
    - **Subject:** early-morning sun slants through a tall window onto a wooden shelf where new film reels and vintage round film canisters are being stacked. One fresh reel catches the light, and dust motes float in the sunbeam.
    - **Palette:** morning gold, teal shadow, film-silver.
    - **Avoid:** any lettering on the canisters.

### Chart collections (3)

23. **`chart-popular.png`**: Popular Movies, and Popular Shows
    - **Subject:** a packed open-air cinema at dusk, seen from the back: a sea of small audience silhouettes faces a huge glowing screen that shows only light, while searchlights sweep the sky.
    - **Palette:** electric magenta, cyan, dusk violet (vivid is fine here).

24. **`chart-top-250.png`**: Top 250 Movies, and Top 250 Shows
    - **Subject:** a single glowing five-pointed star suspended above an empty stage between heavy velvet curtains, encircled by a gilded laurel wreath and lit by one spotlight from above.
    - **Palette:** gold, deep velvet red, black.
    - **Avoid:** award statuettes, a yellow rectangle badge, anything resembling an existing award or ratings site.

25. **`chart-lowest-rated.png`**: Lowest Rated Movies
    - **Subject:** an affectionate "so bad it's good" joke. Under a flickering, buzzing spotlight on an empty cinema floor sits a slumped, half-crumpled popcorn bucket with popcorn spilled around it. A film reel unspools in a tangle and a single rose wilts on a seat.
    - **Palette:** faded olive, dusty pink, dim amber.
    - **Mood:** comic and warm, never mean.

### Streaming services (1)

26. **`streaming.png`**: shared by every streaming-service collection
    - **Subject:** a river of light flowing out of an open doorway into the night sky, made of countless tiny glowing rectangles like little screens, sweeping up and away in a graceful curve. A small silhouette in the doorway watches it go.
    - **Colour (different from the rest):** paint this one in **greyscale only**: black, greys, white and cream, with high contrast. The app tints it with each service's own colour.
    - **Avoid:** logos, play buttons, the shape of any app icon.

### Optional: holiday episode variants (3)

Make these only if the 26 above are done. Without them, the app reuses the seasonal art.

27. **`episodes-christmas.png`**: Christmas Episodes
    - **Subject:** a vintage TV set on a side table beside a decorated tree, its screen glowing with soft light and no picture. Stockings hang nearby and snow falls outside the window.
    - **Palette:** as `seasonal-christmas`.

28. **`episodes-halloween.png`**: Halloween Episodes
    - **Subject:** a vintage TV set glowing in a dark room, with a carved jack-o'-lantern beside it, a black cat sitting on top and autumn leaves blowing past the window.
    - **Palette:** as `seasonal-halloween`.

29. **`episodes-thanksgiving.png`**: Thanksgiving Episodes
    - **Subject:** a family room after dinner, with a vintage TV glowing softly and no picture. A pie with one slice gone sits on the coffee table, and an autumn evening shows through the window.
    - **Palette:** as `seasonal-thanksgiving`.

## Check every image before showing it

- [ ] 2:3 portrait, at least 1024 × 1536, full-bleed, no border or mockup.
- [ ] Absolutely no letters, numbers or letter-like marks anywhere.
- [ ] Main subject in the upper two-thirds, and the bottom third quiet.
- [ ] Reads clearly as a 150-pixel-wide thumbnail.
- [ ] House style: screen-print and gouache texture, layered planes, one light source, cream highlights and ink darks.
- [ ] No logos, characters, real people, flags (except where allowed) or stereotypes.
- [ ] G-rated and gentle.
- [ ] Named exactly as listed.
