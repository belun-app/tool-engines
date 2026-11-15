/**
 * Searchable emoji catalogue with English and Russian names and keywords, grouped like the
 * Unicode emoji list, with skin-tone variants.
 */

export type EmojiGroupId =
  | "smileys"
  | "people"
  | "animals"
  | "food"
  | "activity"
  | "travel"
  | "objects"
  | "symbols"
  | "flags";

export type EmojiLocale = "en" | "ru";

export interface Emoji {
  /** Base character, without any skin-tone modifier applied */
  char: string;
  name: string;
  nameRu: string;
  keywords: string[];
  keywordsRu: string[];
  group: EmojiGroupId;
  /** True when the emoji accepts a Fitzpatrick skin-tone modifier */
  tone: boolean;
}

export interface EmojiGroupInfo {
  id: EmojiGroupId;
  label: string;
  labelRu: string;
  icon: string;
}

export interface EmojiMatch {
  /** Character with the requested skin tone already applied */
  char: string;
  /** Base character without a modifier — use it as a stable key */
  base: string;
  name: string;
  group: EmojiGroupId;
  tone: boolean;
}

export interface EmojiSearchOptions {
  group?: EmojiGroupId | "all" | "";
  locale?: EmojiLocale;
  /** 0 = default yellow, 1–5 = Fitzpatrick types II–VI */
  tone?: number;
  limit?: number;
}

export interface EmojiSearchResult {
  items: EmojiMatch[];
  /** Number of matches before the limit was applied */
  total: number;
  query: string;
  group: EmojiGroupId | "all";
}

/** Fitzpatrick modifiers, index 1–5; index 0 is the default yellow */
export const SKIN_TONE_MODIFIERS = [
  "",
  "\u{1F3FB}",
  "\u{1F3FC}",
  "\u{1F3FD}",
  "\u{1F3FE}",
  "\u{1F3FF}",
];

export const EMOJI_GROUPS: EmojiGroupInfo[] = [
  { id: "smileys", label: "Smileys & Emotion", labelRu: "Смайлы и эмоции", icon: "😀" },
  { id: "people", label: "People & Body", labelRu: "Люди и жесты", icon: "👋" },
  { id: "animals", label: "Animals & Nature", labelRu: "Животные и природа", icon: "🐶" },
  { id: "food", label: "Food & Drink", labelRu: "Еда и напитки", icon: "🍔" },
  { id: "activity", label: "Activities", labelRu: "Активности", icon: "⚽" },
  { id: "travel", label: "Travel & Places", labelRu: "Путешествия и места", icon: "✈️" },
  { id: "objects", label: "Objects", labelRu: "Предметы", icon: "💡" },
  { id: "symbols", label: "Symbols", labelRu: "Символы", icon: "❤️" },
  { id: "flags", label: "Flags", labelRu: "Флаги", icon: "🏁" },
];

/**
 * Compact source rows: "<char> <english name>|<en keywords>|<russian name>|<ru keywords>[|t]"
 * The trailing "t" marks emoji that accept a skin-tone modifier.
 */
const RAW: Record<EmojiGroupId, string[]> = {
  smileys: [
    "😀 grinning face|smile happy grin|улыбающееся лицо|улыбка радость смех",
    "😃 grinning face with big eyes|smile happy joy|улыбка с большими глазами|радость восторг",
    "😄 grinning face with smiling eyes|happy laugh|улыбка с прищуром|радость смех",
    "😁 beaming face with smiling eyes|grin teeth|сияющая улыбка|зубы радость",
    "😆 grinning squinting face|laugh lol haha|смех с зажмуренными глазами|хохот ржака",
    "😅 grinning face with sweat|relief nervous|улыбка с каплей пота|неловкость облегчение",
    "🤣 rolling on the floor laughing|rofl lmao|катаюсь по полу от смеха|ржу хохот",
    "😂 face with tears of joy|lol crying laughing|слёзы радости|ржу смех плачу",
    "🙂 slightly smiling face|smile polite|слегка улыбающееся лицо|вежливая улыбка",
    "🙃 upside-down face|irony sarcasm silly|перевёрнутое лицо|ирония сарказм",
    "😉 winking face|wink flirt joke|подмигивающее лицо|подмигивание флирт",
    "😊 smiling face with smiling eyes|blush warm|улыбка со счастливыми глазами|смущение тепло",
    "😇 smiling face with halo|angel innocent|лицо с нимбом|ангел невинность",
    "🥰 smiling face with hearts|love adore|лицо с сердечками|любовь обожание",
    "😍 smiling face with heart-eyes|love crush|глаза-сердечки|влюблённость восторг",
    "🤩 star-struck|wow amazed excited|глаза-звёзды|восторг вау",
    "😘 face blowing a kiss|kiss love|воздушный поцелуй|поцелуй любовь",
    "😗 kissing face|kiss whistle|целующее лицо|поцелуй свист",
    "😚 kissing face with closed eyes|kiss shy|поцелуй с закрытыми глазами|нежность",
    "😋 face savoring food|yum delicious tasty|облизывается|вкусно язык",
    "😛 face with tongue|tongue playful|показывает язык|дразнится",
    "😜 winking face with tongue|silly joke|подмигивает с языком|шутка дурачится",
    "🤪 zany face|crazy goofy wild|дурашливое лицо|безумие чудачество",
    "🤨 face with raised eyebrow|suspicious doubt|поднятая бровь|подозрение сомнение",
    "🧐 face with monocle|inspect curious|лицо с моноклем|изучение любопытство",
    "🤓 nerd face|geek glasses study|ботаник|очки учёба",
    "😎 smiling face with sunglasses|cool sunglasses|лицо в очках|круто солнце",
    "🥳 partying face|celebration birthday|праздничное лицо|вечеринка день рождения",
    "😏 smirking face|smug flirt|ухмылка|самодовольство флирт",
    "😒 unamused face|annoyed meh|недовольное лицо|раздражение скука",
    "😞 disappointed face|sad let down|разочарованное лицо|грусть",
    "😔 pensive face|sad thoughtful|задумчивое грустное лицо|печаль",
    "😟 worried face|concern anxious|обеспокоенное лицо|тревога",
    "😕 confused face|unsure puzzled|растерянное лицо|непонимание",
    "🙁 slightly frowning face|sad upset|слегка нахмуренное лицо|огорчение",
    "😣 persevering face|struggle strain|страдающее лицо|напряжение",
    "😖 confounded face|frustrated|измученное лицо|досада",
    "😫 tired face|exhausted fed up|усталое лицо|изнеможение",
    "😩 weary face|tired distressed|утомлённое лицо|усталость",
    "🥺 pleading face|puppy eyes beg|умоляющее лицо|щенячьи глазки просьба",
    "😢 crying face|sad tear|плачущее лицо|слеза грусть",
    "😭 loudly crying face|sob bawl|громко плачет|рыдания",
    "😤 face with steam from nose|angry triumph|пар из носа|злость решимость",
    "😠 angry face|mad annoyed|злое лицо|гнев",
    "😡 pouting face|rage furious red|разъярённое лицо|ярость",
    "🤬 face with symbols on mouth|swearing curse|ругательства|мат брань",
    "🤯 exploding head|mind blown shock|взрыв мозга|шок",
    "😳 flushed face|embarrassed surprise|покрасневшее лицо|смущение",
    "🥵 hot face|heat sweating|перегретое лицо|жара",
    "🥶 cold face|freezing frozen|замёрзшее лицо|холод мороз",
    "😱 face screaming in fear|scream shock horror|крик от страха|ужас",
    "😨 fearful face|scared afraid|испуганное лицо|страх",
    "😰 anxious face with sweat|nervous worry|тревога с потом|нервы",
    "😥 sad but relieved face|whew disappointed|грусть с облегчением|уф",
    "😓 downcast face with sweat|hard work sad|поникшее лицо|усталость",
    "🤗 hugging face|hug warm|обнимающее лицо|объятия",
    "🤔 thinking face|think hmm consider|думающее лицо|размышление хмм",
    "🤭 face with hand over mouth|oops giggle|рука у рта|ой хихиканье",
    "🤫 shushing face|quiet secret|тсс|тишина секрет",
    "🤥 lying face|pinocchio liar|лживое лицо|враньё пиноккио",
    "😶 face without mouth|speechless silent|лицо без рта|молчание",
    "😐 neutral face|meh blank|нейтральное лицо|безразличие",
    "😑 expressionless face|blank annoyed|лицо без эмоций|апатия",
    "😬 grimacing face|awkward cringe|гримаса|неловкость",
    "🙄 face with rolling eyes|eyeroll annoyed|закатывает глаза|раздражение",
    "😯 hushed face|surprised oh|удивлённое лицо|ох",
    "😴 sleeping face|sleep zzz|спящее лицо|сон храп",
    "🤤 drooling face|hungry desire|слюнки текут|голод",
    "😪 sleepy face|tired doze|сонное лицо|дремота",
    "😵 face with crossed-out eyes|dizzy knocked out|глаза крестиками|головокружение",
    "🤐 zipper-mouth face|silence secret|рот на замке|молчание",
    "🥴 woozy face|drunk tipsy|поплывшее лицо|подшофе",
    "🤢 nauseated face|sick disgust|тошнотное лицо|отвращение",
    "🤮 face vomiting|puke sick|рвота|тошнит",
    "🤧 sneezing face|sneeze cold flu|чихающее лицо|простуда",
    "😷 face with medical mask|mask sick|лицо в маске|болезнь",
    "🤒 face with thermometer|fever ill|градусник|температура",
    "🤕 face with head-bandage|injured hurt|повязка на голове|травма",
    "🤑 money-mouth face|rich dollar|лицо с деньгами|богатство",
    "🤠 cowboy hat face|cowboy western|ковбойская шляпа|ковбой",
    "😈 smiling face with horns|devil mischief|улыбка с рожками|чертёнок",
    "👿 angry face with horns|devil imp|злой чёрт|бес",
    "👹 ogre|monster oni|огр|монстр",
    "💀 skull|dead death|череп|смерть",
    "☠️ skull and crossbones|poison danger|череп с костями|яд опасность",
    "👻 ghost|halloween spooky|привидение|хэллоуин",
    "👽 alien|ufo extraterrestrial|инопланетянин|нло",
    "🤖 robot|bot ai machine|робот|бот ии",
    "💩 pile of poo|poop funny|какашка|шутка",
    "😺 grinning cat|cat smile|улыбающийся кот|кот",
    "😹 cat with tears of joy|cat laugh|кот со слезами радости|смех кот",
    "😻 smiling cat with heart-eyes|cat love|кот с сердечками|любовь кот",
    "🙈 see-no-evil monkey|monkey shy|обезьяна закрыла глаза|стыд",
    "🙉 hear-no-evil monkey|monkey deaf|обезьяна закрыла уши|не слышу",
    "🙊 speak-no-evil monkey|monkey quiet|обезьяна закрыла рот|молчу",
    "💋 kiss mark|lipstick kiss|след поцелуя|помада",
    "💌 love letter|letter romance|любовное письмо|романтика",
    "💘 heart with arrow|cupid love|сердце со стрелой|купидон",
    "💝 heart with ribbon|gift love|сердце с лентой|подарок",
    "💖 sparkling heart|love shine|сверкающее сердце|любовь",
    "💗 growing heart|love pulse|растущее сердце|любовь",
    "💓 beating heart|heartbeat love|бьющееся сердце|пульс",
    "💞 revolving hearts|love couple|кружащиеся сердца|пара",
    "💕 two hearts|love couple|два сердца|любовь",
    "❤️ red heart|love heart|красное сердце|любовь сердечко",
    "🧡 orange heart|love orange|оранжевое сердце|любовь",
    "💛 yellow heart|love yellow friendship|жёлтое сердце|дружба",
    "💚 green heart|love green|зелёное сердце|любовь",
    "💙 blue heart|love blue|синее сердце|любовь",
    "💜 purple heart|love purple|фиолетовое сердце|любовь",
    "🖤 black heart|dark love|чёрное сердце|тьма",
    "🤍 white heart|pure love|белое сердце|чистота",
    "🤎 brown heart|love brown|коричневое сердце|любовь",
    "💔 broken heart|breakup sad|разбитое сердце|расставание",
    "❣️ heart exclamation|love emphasis|сердце с восклицанием|любовь",
    "💯 hundred points|perfect score keep it|сто баллов|отлично идеально",
    "💢 anger symbol|mad vein|символ злости|гнев",
    "💥 collision|boom explosion|взрыв|бум",
    "💫 dizzy|stars swirl|звёздочки|головокружение",
    "💦 sweat droplets|water splash|капли|вода пот",
    "💨 dashing away|fast wind|унёсся|ветер скорость",
    "💬 speech balloon|comment chat|облачко реплики|комментарий чат",
    "💭 thought balloon|thinking dream|облачко мыслей|мысли",
    "💤 zzz|sleep snore|zzz|сон храп",
  ],
  people: [
    "👋 waving hand|hello hi bye wave|машущая рука|привет пока|t",
    "🤚 raised back of hand|hand stop|тыльная сторона руки|рука|t",
    "🖐️ hand with fingers splayed|five hand|раскрытая ладонь|пять пальцев|t",
    "✋ raised hand|stop high five|поднятая ладонь|стоп пятерня|t",
    "🖖 vulcan salute|spock star trek|приветствие вулканца|спок|t",
    "👌 OK hand|ok perfect|жест окей|отлично|t",
    "🤌 pinched fingers|italian gesture|щепотка пальцев|итальянский жест|t",
    "🤏 pinching hand|small tiny|щепотка|чуть-чуть|t",
    "✌️ victory hand|peace two|виктория|мир два пальца|t",
    "🤞 crossed fingers|luck hope|скрещённые пальцы|удача надежда|t",
    "🤟 love-you gesture|ily love|жест люблю тебя|любовь|t",
    "🤘 sign of the horns|rock metal|коза|рок метал|t",
    "🤙 call me hand|shaka call|позвони мне|шака|t",
    "👈 backhand index pointing left|left point|палец влево|указатель|t",
    "👉 backhand index pointing right|right point|палец вправо|указатель|t",
    "👆 backhand index pointing up|up point|палец вверх|указатель|t",
    "👇 backhand index pointing down|down point|палец вниз|указатель|t",
    "☝️ index pointing up|one attention|указательный вверх|внимание|t",
    "👍 thumbs up|like yes approve|палец вверх|лайк одобрение|t",
    "👎 thumbs down|dislike no|палец вниз|дизлайк|t",
    "✊ raised fist|fist power|поднятый кулак|сила|t",
    "👊 oncoming fist|punch bump|кулак вперёд|удар|t",
    "🤛 left-facing fist|bump fist|кулак влево|привет кулаком|t",
    "🤜 right-facing fist|bump fist|кулак вправо|привет кулаком|t",
    "👏 clapping hands|applause bravo|аплодисменты|браво хлопки|t",
    "🙌 raising hands|celebrate praise|поднятые руки|радость ура|t",
    "👐 open hands|hug open|открытые ладони|объятия|t",
    "🤲 palms up together|pray request|ладони вверх|просьба|t",
    "🤝 handshake|deal agreement|рукопожатие|сделка договор",
    "🙏 folded hands|please thanks pray|сложенные ладони|спасибо молитва|t",
    "✍️ writing hand|write sign|пишущая рука|подпись|t",
    "💅 nail polish|manicure care|маникюр|лак ногти|t",
    "🤳 selfie|photo phone|селфи|фото|t",
    "💪 flexed biceps|strong gym muscle|бицепс|сила спортзал|t",
    "🦵 leg|kick limb|нога|пинок|t",
    "🦶 foot|kick step|ступня|шаг|t",
    "👂 ear|hear listen|ухо|слух|t",
    "👃 nose|smell|нос|запах|t",
    "🧠 brain|smart mind|мозг|ум мышление",
    "🫀 anatomical heart|organ cardio|анатомическое сердце|орган",
    "🦷 tooth|dentist teeth|зуб|стоматолог",
    "🦴 bone|skeleton dog|кость|скелет",
    "👀 eyes|look watch see|глаза|смотреть",
    "👁️ eye|look see|глаз|взгляд",
    "👅 tongue|taste lick|язык|вкус",
    "👄 mouth|lips kiss|губы|рот",
    "👶 baby|infant child|младенец|ребёнок|t",
    "🧒 child|kid young|ребёнок|дитя|t",
    "👦 boy|kid son|мальчик|сын|t",
    "👧 girl|kid daughter|девочка|дочь|t",
    "🧑 person|adult human|человек|взрослый|t",
    "👨 man|male adult|мужчина|взрослый|t",
    "👩 woman|female adult|женщина|взрослая|t",
    "🧓 older person|elder senior|пожилой человек|старший|t",
    "👴 old man|grandpa elder|дедушка|старик|t",
    "👵 old woman|grandma elder|бабушка|старушка|t",
    "🙍 person frowning|sad upset|хмурящийся человек|огорчение|t",
    "🙅 person gesturing no|no forbidden|жест нет|запрет|t",
    "🙆 person gesturing OK|ok yes|жест окей|да|t",
    "💁 person tipping hand|sassy info|подсказывающий человек|информация|t",
    "🙋 person raising hand|question volunteer|поднятая рука|вопрос|t",
    "🙇 person bowing|sorry respect|поклон|извинение уважение|t",
    "🤦 person facepalming|facepalm disbelief|фейспалм|недоумение|t",
    "🤷 person shrugging|shrug idk|пожимает плечами|не знаю|t",
    "👮 police officer|cop law|полицейский|закон|t",
    "👷 construction worker|builder helmet|строитель|каска|t",
    "💂 guard|soldier london|гвардеец|солдат|t",
    "🕵️ detective|spy investigate|детектив|шпион|t",
    "👨‍⚕️ man health worker|doctor nurse|врач мужчина|доктор|t",
    "👩‍⚕️ woman health worker|doctor nurse|врач женщина|доктор|t",
    "👨‍🎓 man student|graduate school|студент|выпускник|t",
    "👩‍🎓 woman student|graduate school|студентка|выпускница|t",
    "👨‍🏫 man teacher|professor school|учитель|преподаватель|t",
    "👩‍🏫 woman teacher|professor school|учительница|преподавательница|t",
    "👨‍💻 man technologist|developer coder|программист|разработчик|t",
    "👩‍💻 woman technologist|developer coder|программистка|разработчица|t",
    "👨‍🍳 man cook|chef kitchen|повар|шеф|t",
    "👩‍🍳 woman cook|chef kitchen|повариха|шеф|t",
    "🧑‍🚀 astronaut|space nasa|космонавт|космос|t",
    "🧑‍🚒 firefighter|fire rescue|пожарный|спасатель|t",
    "🤵 person in tuxedo|groom formal|человек в смокинге|жених|t",
    "👰 person with veil|bride wedding|человек в фате|невеста свадьба|t",
    "🤰 pregnant woman|pregnancy baby|беременная|беременность|t",
    "🎅 Santa Claus|christmas xmas|Санта-Клаус|рождество|t",
    "🦸 superhero|hero power|супергерой|герой|t",
    "🦹 supervillain|villain evil|суперзлодей|злодей|t",
    "🧙 mage|wizard magic|маг|волшебник|t",
    "🧚 fairy|magic wings|фея|магия|t",
    "🧛 vampire|dracula fangs|вампир|дракула|t",
    "🧜 merperson|mermaid sea|русал|русалка море|t",
    "🧝 elf|fantasy ears|эльф|фэнтези|t",
    "💃 woman dancing|dance flamenco|танцующая женщина|танец|t",
    "🕺 man dancing|dance disco|танцующий мужчина|танец|t",
    "🚶 person walking|walk stroll|идущий человек|прогулка|t",
    "🏃 person running|run marathon|бегущий человек|бег|t",
    "🧎 person kneeling|kneel pray|человек на коленях|мольба|t",
    "🤸 person cartwheeling|gymnastics flip|колесо|гимнастика|t",
    "🛀 person taking bath|bath relax|человек в ванне|отдых|t",
    "🛌 person in bed|sleep hotel|человек в кровати|сон|t",
    "👪 family|parents kids|семья|родители дети",
    "👫 woman and man holding hands|couple date|пара за руки|свидание|t",
    "🫂 people hugging|hug support|обнимающиеся люди|поддержка",
  ],
  animals: [
    "🐶 dog face|puppy pet|морда собаки|щенок питомец",
    "🐱 cat face|kitten pet|морда кошки|котёнок питомец",
    "🐭 mouse face|rodent|морда мыши|грызун",
    "🐹 hamster|pet rodent|хомяк|грызун",
    "🐰 rabbit face|bunny easter|морда кролика|зайчик пасха",
    "🦊 fox|clever orange|лиса|хитрость",
    "🐻 bear|grizzly|медведь|гризли",
    "🐼 panda|bamboo china|панда|бамбук",
    "🐨 koala|australia|коала|австралия",
    "🐯 tiger face|stripes|морда тигра|полоски",
    "🦁 lion|king mane|лев|царь зверей",
    "🐮 cow face|milk farm|морда коровы|молоко ферма",
    "🐷 pig face|farm oink|морда свиньи|ферма",
    "🐸 frog|toad green|лягушка|жаба",
    "🐵 monkey face|ape|морда обезьяны|примат",
    "🦍 gorilla|ape strong|горилла|примат",
    "🐔 chicken|hen farm|курица|ферма",
    "🐧 penguin|antarctica|пингвин|антарктида",
    "🐦 bird|tweet fly|птица|полёт",
    "🐤 baby chick|chicken cute|цыплёнок|птенец",
    "🦆 duck|quack pond|утка|пруд",
    "🦅 eagle|hawk fly|орёл|хищник",
    "🦉 owl|night wise|сова|мудрость",
    "🦇 bat|night vampire|летучая мышь|ночь",
    "🐺 wolf|howl wild|волк|вой",
    "🐴 horse face|pony|морда лошади|пони",
    "🦄 unicorn|magic fantasy|единорог|магия",
    "🐝 honeybee|honey buzz|пчела|мёд",
    "🐛 bug|caterpillar insect|гусеница|насекомое",
    "🦋 butterfly|wings spring|бабочка|крылья весна",
    "🐌 snail|slow shell|улитка|медленно",
    "🐞 lady beetle|ladybug luck|божья коровка|удача",
    "🐜 ant|insect work|муравей|насекомое",
    "🕷️ spider|web halloween|паук|паутина",
    "🐢 turtle|slow shell|черепаха|панцирь",
    "🐍 snake|serpent python|змея|питон",
    "🦎 lizard|reptile gecko|ящерица|рептилия",
    "🐙 octopus|tentacles sea|осьминог|море",
    "🦐 shrimp|seafood|креветка|морепродукты",
    "🦀 crab|seafood claw|краб|клешня",
    "🐠 tropical fish|aquarium reef|тропическая рыба|аквариум",
    "🐟 fish|fishing sea|рыба|рыбалка",
    "🐬 dolphin|sea smart|дельфин|море",
    "🐳 spouting whale|sea big|кит фонтан|море",
    "🦈 shark|jaws danger|акула|опасность",
    "🐊 crocodile|alligator reptile|крокодил|аллигатор",
    "🦓 zebra|stripes africa|зебра|полоски",
    "🐘 elephant|trunk big|слон|хобот",
    "🦒 giraffe|tall neck|жираф|шея",
    "🐄 cow|milk farm|корова|молоко",
    "🐑 ewe|sheep wool|овца|шерсть",
    "🦙 llama|alpaca wool|лама|альпака",
    "🐐 goat|farm horns|коза|рога",
    "🦌 deer|antlers forest|олень|рога лес",
    "🐕 dog|pet loyal|собака|питомец",
    "🐈 cat|pet meow|кошка|питомец",
    "🐓 rooster|cock morning|петух|утро",
    "🦃 turkey|thanksgiving|индейка|день благодарения",
    "🕊️ dove|peace bird|голубь|мир",
    "🦝 raccoon|trash bandit|енот|полоскун",
    "🦔 hedgehog|spiky|ёжик|колючки",
    "🐾 paw prints|animal tracks|следы лап|животное",
    "🌵 cactus|desert plant|кактус|пустыня",
    "🎄 Christmas tree|xmas holiday|новогодняя ёлка|рождество праздник",
    "🌲 evergreen tree|pine forest|хвойное дерево|сосна лес",
    "🌳 deciduous tree|forest oak|лиственное дерево|лес дуб",
    "🌴 palm tree|beach tropical|пальма|пляж тропики",
    "🌱 seedling|sprout grow|росток|рассада",
    "🌿 herb|plant leaf|трава|растение",
    "🍀 four leaf clover|luck irish|четырёхлистный клевер|удача",
    "🍃 leaf fluttering in wind|leaves breeze|листья на ветру|ветер",
    "🍂 fallen leaf|autumn fall|опавшие листья|осень",
    "🍁 maple leaf|canada autumn|кленовый лист|осень канада",
    "🌾 sheaf of rice|wheat harvest|колосья|урожай пшеница",
    "🌷 tulip|flower spring|тюльпан|весна цветок",
    "🌹 rose|flower love|роза|цветок любовь",
    "🥀 wilted flower|dead sad|увядший цветок|грусть",
    "🌺 hibiscus|flower tropical|гибискус|тропики",
    "🌸 cherry blossom|sakura spring|сакура|весна",
    "🌼 blossom|daisy flower|ромашка|цветок",
    "🌻 sunflower|summer yellow|подсолнух|лето",
    "🌞 sun with face|sunny bright|солнце с лицом|ясно",
    "🌙 crescent moon|night sleep|полумесяц|ночь",
    "⭐ star|favorite rating|звезда|избранное рейтинг",
    "🌟 glowing star|shine sparkle|сияющая звезда|блеск",
    "✨ sparkles|magic shine new|искры|магия блеск",
    "⚡ high voltage|lightning power|молния|электричество",
    "☄️ comet|space meteor|комета|метеор",
    "🔥 fire|hot flame lit|огонь|пламя жара",
    "🌪️ tornado|storm wind|торнадо|смерч",
    "🌈 rainbow|colors pride|радуга|цвета",
    "☀️ sun|sunny clear|солнце|ясно",
    "⛅ sun behind cloud|partly cloudy|солнце за облаком|переменная облачность",
    "☁️ cloud|cloudy weather|облако|погода",
    "🌧️ cloud with rain|rainy weather|дождь|погода",
    "⛈️ cloud with lightning and rain|storm|гроза|ливень",
    "❄️ snowflake|snow cold winter|снежинка|снег зима",
    "☃️ snowman|winter snow|снеговик|зима",
    "💧 droplet|water drop|капля|вода",
    "🌊 water wave|sea ocean surf|волна|море океан",
  ],
  food: [
    "🍎 red apple|fruit healthy|красное яблоко|фрукт",
    "🍏 green apple|fruit sour|зелёное яблоко|фрукт",
    "🍐 pear|fruit|груша|фрукт",
    "🍊 tangerine|orange fruit|мандарин|цитрус",
    "🍋 lemon|sour citrus|лимон|цитрус кислый",
    "🍌 banana|fruit yellow|банан|фрукт",
    "🍉 watermelon|summer fruit|арбуз|лето",
    "🍇 grapes|wine fruit|виноград|вино",
    "🍓 strawberry|berry sweet|клубника|ягода",
    "🫐 blueberries|berry|черника|ягода",
    "🍒 cherries|fruit red|вишня|ягода",
    "🍑 peach|fruit butt|персик|фрукт",
    "🥭 mango|tropical fruit|манго|тропики",
    "🍍 pineapple|tropical fruit|ананас|тропики",
    "🥥 coconut|tropical|кокос|тропики",
    "🥝 kiwi fruit|green fruit|киви|фрукт",
    "🍅 tomato|vegetable salad|помидор|овощ",
    "🍆 eggplant|aubergine vegetable|баклажан|овощ",
    "🥑 avocado|toast healthy|авокадо|тост",
    "🥦 broccoli|vegetable green|брокколи|овощ",
    "🥬 leafy green|salad lettuce|листовой салат|зелень",
    "🥒 cucumber|pickle vegetable|огурец|овощ",
    "🌶️ hot pepper|spicy chili|острый перец|чили",
    "🌽 ear of corn|maize|кукуруза|початок",
    "🥕 carrot|vegetable orange|морковь|овощ",
    "🧄 garlic|flavor|чеснок|приправа",
    "🧅 onion|flavor tears|лук|слёзы",
    "🥔 potato|fries vegetable|картофель|овощ",
    "🥐 croissant|bakery french|круассан|выпечка",
    "🍞 bread|loaf bakery|хлеб|буханка",
    "🥖 baguette bread|french bakery|багет|выпечка",
    "🥨 pretzel|snack german|крендель|снек",
    "🧀 cheese wedge|dairy|сыр|молочное",
    "🥚 egg|breakfast protein|яйцо|завтрак",
    "🍳 cooking|fried egg breakfast|яичница|завтрак",
    "🥞 pancakes|breakfast syrup|блины|завтрак",
    "🧇 waffle|breakfast|вафля|завтрак",
    "🥓 bacon|meat breakfast|бекон|мясо",
    "🥩 cut of meat|steak beef|стейк|мясо",
    "🍗 poultry leg|chicken drumstick|куриная ножка|мясо",
    "🌭 hot dog|sausage fast food|хот-дог|фастфуд",
    "🍔 hamburger|burger fast food|бургер|фастфуд",
    "🍟 french fries|fast food chips|картофель фри|фастфуд",
    "🍕 pizza|slice italian|пицца|италия",
    "🥪 sandwich|lunch bread|сэндвич|обед",
    "🌮 taco|mexican|тако|мексика",
    "🌯 burrito|wrap mexican|буррито|мексика",
    "🥗 green salad|healthy lunch|салат|здоровое питание",
    "🍝 spaghetti|pasta italian|спагетти|паста",
    "🍜 steaming bowl|ramen noodles|рамен|лапша",
    "🍲 pot of food|stew soup|суп|рагу",
    "🍛 curry rice|indian|карри с рисом|индия",
    "🍣 sushi|japanese fish|суши|япония",
    "🍱 bento box|japanese lunch|бэнто|япония",
    "🥟 dumpling|pelmeni gyoza|пельмень|вареник",
    "🍤 fried shrimp|tempura|креветка в кляре|темпура",
    "🍚 cooked rice|bowl|варёный рис|миска",
    "🍦 soft ice cream|dessert cone|мороженое рожок|десерт",
    "🍰 shortcake|cake dessert|кусок торта|десерт",
    "🎂 birthday cake|celebration|праздничный торт|день рождения",
    "🧁 cupcake|dessert sweet|капкейк|десерт",
    "🍩 doughnut|donut sweet|пончик|сладость",
    "🍪 cookie|biscuit sweet|печенье|сладость",
    "🍫 chocolate bar|sweet cocoa|шоколад|сладость",
    "🍬 candy|sweet sugar|конфета|сладость",
    "🍭 lollipop|candy sweet|леденец|сладость",
    "🍿 popcorn|cinema movie|попкорн|кино",
    "☕ hot beverage|coffee tea|горячий напиток|кофе чай",
    "🍵 teacup without handle|green tea|чашка чая|зелёный чай",
    "🧃 beverage box|juice|сок в коробке|напиток",
    "🥤 cup with straw|soda drink|стакан с трубочкой|газировка",
    "🍺 beer mug|pub drink|кружка пива|паб",
    "🍻 clinking beer mugs|cheers|пивные кружки|тост",
    "🥂 clinking glasses|celebration champagne|бокалы|тост шампанское",
    "🍷 wine glass|red wine|бокал вина|вино",
    "🥃 tumbler glass|whisky|стакан виски|виски",
    "🍸 cocktail glass|martini bar|коктейль|бар",
    "🍹 tropical drink|cocktail beach|тропический коктейль|пляж",
    "🍾 bottle with popping cork|champagne party|шампанское|праздник",
    "🧊 ice|cube cold|лёд|кубик",
    "🍴 fork and knife|eat restaurant|вилка и нож|ресторан",
    "🥄 spoon|eat|ложка|еда",
  ],
  activity: [
    "⚽ soccer ball|football sport|футбольный мяч|футбол",
    "🏀 basketball|sport nba|баскетбольный мяч|баскетбол",
    "🏈 american football|nfl sport|мяч для американского футбола|нфл",
    "⚾ baseball|sport mlb|бейсбольный мяч|бейсбол",
    "🎾 tennis|sport racquet|теннисный мяч|теннис",
    "🏐 volleyball|sport beach|волейбольный мяч|волейбол",
    "🏉 rugby football|sport|мяч для регби|регби",
    "🎱 pool 8 ball|billiards|бильярдный шар|бильярд",
    "🏓 ping pong|table tennis|пинг-понг|настольный теннис",
    "🏸 badminton|shuttlecock|бадминтон|волан",
    "🏒 ice hockey|stick puck|хоккей|клюшка шайба",
    "🏑 field hockey|stick ball|хоккей на траве|клюшка",
    "🏏 cricket game|bat ball|крикет|бита",
    "🥅 goal net|score|ворота|сетка гол",
    "⛳ flag in hole|golf|гольф|лунка флаг",
    "🪁 kite|wind fly|воздушный змей|ветер",
    "🏹 bow and arrow|archery aim|лук и стрела|стрельба",
    "🎣 fishing pole|fish hobby|удочка|рыбалка",
    "🥊 boxing glove|fight sport|боксёрская перчатка|бокс",
    "🥋 martial arts uniform|judo karate|кимоно|дзюдо карате",
    "🛹 skateboard|skate street|скейтборд|скейт",
    "⛸️ ice skate|skating winter|коньки|каток",
    "🎿 skis|winter snow|лыжи|зима",
    "🏂 snowboarder|winter snow|сноубордист|зима",
    "🏋️ person lifting weights|gym strength|штангист|спортзал|t",
    "⛹️ person bouncing ball|basketball|человек с мячом|баскетбол|t",
    "🧘 person in lotus position|yoga meditate|поза лотоса|йога медитация|t",
    "🏄 person surfing|surf wave|сёрфер|волна|t",
    "🏊 person swimming|swim pool|пловец|бассейн|t",
    "🚣 person rowing boat|row|гребец|лодка|t",
    "🧗 person climbing|climb rock|скалолаз|скалолазание|t",
    "🚴 person biking|cycling bike|велосипедист|велоспорт|t",
    "🚵 person mountain biking|mtb|горный велосипедист|велоспорт|t",
    "🏆 trophy|win champion award|кубок|победа награда",
    "🥇 1st place medal|gold win|золотая медаль|первое место",
    "🥈 2nd place medal|silver|серебряная медаль|второе место",
    "🥉 3rd place medal|bronze|бронзовая медаль|третье место",
    "🏅 sports medal|award win|спортивная медаль|награда",
    "🎫 ticket|event admission|билет|мероприятие",
    "🎪 circus tent|carnival show|цирк|шатёр",
    "🤹 person juggling|juggle circus|жонглёр|цирк|t",
    "🎭 performing arts|theater drama|театр|маски драма",
    "🎨 artist palette|paint art|палитра|живопись",
    "🎬 clapper board|movie film|хлопушка|кино",
    "🎤 microphone|sing karaoke|микрофон|караоке",
    "🎧 headphone|music listen|наушники|музыка",
    "🎼 musical score|notes music|нотный стан|музыка",
    "🎹 musical keyboard|piano|клавиши|пианино",
    "🥁 drum|beat music|барабан|ритм",
    "🎷 saxophone|jazz music|саксофон|джаз",
    "🎺 trumpet|brass music|труба|духовые",
    "🎸 guitar|rock music|гитара|рок",
    "🎻 violin|classical music|скрипка|классика",
    "🎲 game die|dice random|игральная кость|случайность",
    "♟️ chess pawn|chess strategy|шахматная пешка|шахматы",
    "🎯 bullseye|darts target goal|мишень|дартс цель",
    "🎳 bowling|strike pins|боулинг|кегли",
    "🎮 video game|gaming controller|геймпад|видеоигры",
    "🎰 slot machine|casino gamble|игровой автомат|казино",
    "🧩 puzzle piece|jigsaw solve|пазл|головоломка",
  ],
  travel: [
    "🚗 automobile|car drive|автомобиль|машина",
    "🚕 taxi|cab ride|такси|поездка",
    "🚙 sport utility vehicle|suv car|внедорожник|машина",
    "🚌 bus|transit public|автобус|транспорт",
    "🏎️ racing car|f1 speed|гоночная машина|формула скорость",
    "🚓 police car|cop siren|полицейская машина|сирена",
    "🚑 ambulance|emergency medical|скорая помощь|неотложка",
    "🚒 fire engine|firetruck|пожарная машина|пожар",
    "🚚 delivery truck|shipping|грузовик|доставка",
    "🚜 tractor|farm agriculture|трактор|ферма",
    "🛴 kick scooter|scooter ride|самокат|поездка",
    "🚲 bicycle|bike cycling|велосипед|велоспорт",
    "🛵 motor scooter|vespa|мопед|скутер",
    "🏍️ motorcycle|bike ride|мотоцикл|байк",
    "🚨 police car light|siren alert|проблесковый маячок|сирена тревога",
    "🚋 tram car|streetcar|трамвайный вагон|трамвай",
    "🚄 high-speed train|bullet rail|скоростной поезд|железная дорога",
    "🚂 locomotive|steam train|паровоз|поезд",
    "🚇 metro|subway underground|метро|подземка",
    "🚉 station|train platform|вокзал|станция",
    "✈️ airplane|flight travel|самолёт|перелёт",
    "🛫 airplane departure|takeoff|взлёт|вылет",
    "🛬 airplane arrival|landing|посадка|прилёт",
    "💺 seat|flight chair|кресло|место",
    "🛰️ satellite|space orbit|спутник|орбита",
    "🚀 rocket|launch space startup|ракета|запуск космос",
    "🛸 flying saucer|ufo alien|летающая тарелка|нло",
    "🚁 helicopter|chopper fly|вертолёт|полёт",
    "⛵ sailboat|yacht sea|парусник|яхта",
    "🚤 speedboat|motorboat|катер|скорость",
    "🛳️ passenger ship|cruise|круизный лайнер|круиз",
    "⛴️ ferry|boat transport|паром|переправа",
    "🚢 ship|cargo sea|корабль|море",
    "⚓ anchor|ship sea|якорь|море",
    "⛽ fuel pump|gas station|заправка|бензин",
    "🚧 construction|roadwork barrier|дорожные работы|ограждение",
    "🚦 vertical traffic light|signal stop|светофор|сигнал",
    "🗺️ world map|travel navigation|карта мира|навигация",
    "🗿 moai|easter island statue|моаи|остров пасхи",
    "🗽 Statue of Liberty|new york usa|статуя свободы|нью-йорк",
    "🗼 Tokyo tower|japan landmark|токийская башня|япония",
    "🏰 castle|fortress fairy tale|замок|крепость",
    "🏯 Japanese castle|japan|японский замок|япония",
    "🏟️ stadium|arena sport|стадион|арена",
    "🎡 ferris wheel|carnival park|колесо обозрения|парк",
    "🎢 roller coaster|theme park|американские горки|парк аттракционов",
    "⛲ fountain|park water|фонтан|парк",
    "🏖️ beach with umbrella|vacation sand|пляж с зонтом|отпуск",
    "🏝️ desert island|tropical vacation|необитаемый остров|тропики",
    "🏜️ desert|sand dry|пустыня|песок",
    "🌋 volcano|eruption lava|вулкан|извержение",
    "⛰️ mountain|peak hike|гора|поход",
    "🏔️ snow-capped mountain|alps peak|заснеженная гора|альпы",
    "🏕️ camping|tent outdoors|кемпинг|палатка",
    "🏠 house|home building|дом|жильё",
    "🏡 house with garden|home yard|дом с садом|участок",
    "🏢 office building|work company|офисное здание|работа",
    "🏬 department store|shopping mall|торговый центр|шопинг",
    "🏥 hospital|medical clinic|больница|клиника",
    "🏦 bank|money finance|банк|финансы",
    "🏨 hotel|stay travel|отель|проживание",
    "🏪 convenience store|shop 24|магазин|круглосуточно",
    "🏫 school|education building|школа|образование",
    "💒 wedding|church marriage|венчание|свадьба",
    "🏛️ classical building|museum government|классическое здание|музей",
    "⛪ church|christian religion|церковь|религия",
    "🕌 mosque|islam religion|мечеть|ислам",
    "🛕 hindu temple|religion|индуистский храм|религия",
    "⛩️ shinto shrine|japan torii|синтоистские ворота|япония",
    "🌃 night with stars|city night|ночной город|звёзды",
    "🏙️ cityscape|skyline urban|городской пейзаж|небоскрёбы",
    "🌅 sunrise|morning dawn|восход|утро",
    "🌇 sunset|evening dusk|закат|вечер",
    "🌉 bridge at night|city bridge|мост ночью|город",
    "🌐 globe with meridians|world internet|глобус с меридианами|интернет мир",
    "🧭 compass|navigation direction|компас|навигация",
  ],
  objects: [
    "⌚ watch|time wrist|наручные часы|время",
    "📱 mobile phone|smartphone cell|мобильный телефон|смартфон",
    "💻 laptop|computer work|ноутбук|компьютер",
    "⌨️ keyboard|typing input|клавиатура|набор текста",
    "🖥️ desktop computer|monitor pc|настольный компьютер|монитор",
    "🖨️ printer|print paper|принтер|печать",
    "🖱️ computer mouse|click|компьютерная мышь|клик",
    "💾 floppy disk|save retro|дискета|сохранить",
    "💿 optical disk|cd disc|компакт-диск|диск",
    "📷 camera|photo picture|фотоаппарат|фото",
    "📹 video camera|record film|видеокамера|запись",
    "🎥 movie camera|cinema film|кинокамера|кино",
    "📞 telephone receiver|call phone|телефонная трубка|звонок",
    "📺 television|tv watch|телевизор|просмотр",
    "📻 radio|broadcast news|радио|эфир",
    "🎙️ studio microphone|podcast record|студийный микрофон|подкаст",
    "⏰ alarm clock|wake morning|будильник|утро",
    "⏳ hourglass|time waiting|песочные часы|ожидание",
    "⏱️ stopwatch|timer speed|секундомер|таймер",
    "📡 satellite antenna|signal dish|спутниковая антенна|сигнал",
    "🔋 battery|power charge|батарея|заряд",
    "🔌 electric plug|power socket|вилка|розетка",
    "💡 light bulb|idea lamp|лампочка|идея",
    "🔦 flashlight|torch light|фонарик|свет",
    "🕯️ candle|light memorial|свеча|свет",
    "🧯 fire extinguisher|safety|огнетушитель|безопасность",
    "💸 money with wings|spending cash|деньги с крыльями|траты",
    "💵 dollar banknote|money cash|долларовая купюра|деньги",
    "💰 money bag|cash wealth|мешок денег|богатство",
    "💳 credit card|payment pay|банковская карта|оплата",
    "🧾 receipt|bill invoice|чек|счёт",
    "💎 gem stone|diamond jewel|драгоценный камень|бриллиант",
    "⚖️ balance scale|justice law|весы|правосудие",
    "🧰 toolbox|repair tools|ящик с инструментами|ремонт",
    "🔧 wrench|repair fix|гаечный ключ|ремонт",
    "🔨 hammer|build nail|молоток|стройка",
    "🛠️ hammer and wrench|tools settings|молоток и ключ|инструменты",
    "🔩 nut and bolt|hardware|болт и гайка|крепёж",
    "⚙️ gear|settings cog|шестерёнка|настройки",
    "🧱 brick|wall build|кирпич|стена",
    "🔗 link|chain url|ссылка|цепь url",
    "🧲 magnet|attract|магнит|притяжение",
    "💣 bomb|explosive danger|бомба|взрывчатка",
    "🧨 firecracker|dynamite explosive|петарда|динамит",
    "🔪 kitchen knife|cut chef|кухонный нож|нарезка",
    "🛡️ shield|defense protect|щит|защита",
    "🔮 crystal ball|fortune magic|хрустальный шар|гадание",
    "🔭 telescope|space astronomy|телескоп|астрономия",
    "🔬 microscope|science lab|микроскоп|наука",
    "💊 pill|medicine drug|таблетка|лекарство",
    "💉 syringe|vaccine injection|шприц|прививка",
    "🧬 dna|genetics biology|днк|генетика",
    "🦠 microbe|virus bacteria|микроб|вирус бактерия",
    "🧪 test tube|chemistry lab|пробирка|химия",
    "🌡️ thermometer|temperature heat|термометр|температура",
    "🧹 broom|clean sweep|метла|уборка",
    "🧻 roll of paper|toilet tissue|рулон бумаги|туалетная",
    "🚿 shower|bath water|душ|ванная",
    "🛁 bathtub|bath relax|ванна|отдых",
    "🧼 soap|wash clean|мыло|мытьё",
    "🔑 key|unlock access|ключ|доступ",
    "🚪 door|entrance exit|дверь|вход",
    "🛋️ couch and lamp|living room|диван и лампа|гостиная",
    "🛏️ bed|sleep hotel|кровать|сон",
    "🪑 chair|seat furniture|стул|мебель",
    "🖼️ framed picture|art frame|картина в рамке|искусство",
    "🛍️ shopping bags|buy retail|сумки с покупками|шопинг",
    "🛒 shopping cart|buy trolley|тележка|покупки",
    "🎁 wrapped gift|present birthday|подарок|день рождения",
    "🎈 balloon|party birthday|воздушный шарик|праздник",
    "🎊 confetti ball|party celebrate|конфетти|праздник",
    "🎉 party popper|celebration congrats|хлопушка|поздравление",
    "📦 package|box shipping|коробка|посылка",
    "✉️ envelope|mail letter|конверт|письмо",
    "📧 e-mail|inbox message|электронная почта|сообщение",
    "📝 memo|note write|заметка|запись",
    "✏️ pencil|write draw|карандаш|письмо",
    "🖊️ pen|write ink|ручка|письмо",
    "📚 books|study library|книги|учёба библиотека",
    "📖 open book|read study|открытая книга|чтение",
    "📄 page facing up|document file|документ|файл",
    "📋 clipboard|copy paste list|планшет с зажимом|копирование список",
    "📌 pushpin|pin location|канцелярская кнопка|закрепить",
    "📎 paperclip|attach file|скрепка|вложение",
    "📏 straight ruler|measure|линейка|измерение",
    "✂️ scissors|cut|ножницы|вырезать",
    "🗑️ wastebasket|trash delete|корзина|удалить",
    "🔒 locked|secure private|замок закрыт|безопасность",
    "🔓 unlocked|open access|замок открыт|доступ",
    "📈 chart increasing|growth up|график роста|рост",
    "📉 chart decreasing|loss down|график падения|падение",
    "📊 bar chart|stats data|столбчатая диаграмма|статистика",
    "🗓️ spiral calendar|date schedule|календарь|расписание",
  ],
  symbols: [
    "✅ check mark button|yes done ok|галочка|готово да",
    "☑️ check box with check|done tick|отмеченный чекбокс|готово",
    "✔️ check mark|yes correct|галочка|верно",
    "❌ cross mark|no wrong delete|крестик|нет неверно",
    "❓ question mark|help ask|вопросительный знак|вопрос",
    "❗ exclamation mark|warning important|восклицательный знак|важно",
    "⚠️ warning|caution alert|предупреждение|осторожно",
    "♻️ recycling symbol|eco green|переработка|экология",
    "⭕ hollow red circle|correct o|красный круг|верно",
    "🚫 prohibited|no forbidden ban|запрещено|нельзя",
    "⛔ no entry|stop forbidden|въезд запрещён|стоп",
    "🔞 no one under eighteen|adult 18|только 18+|взрослым",
    "☢️ radioactive|nuclear danger|радиация|опасность",
    "☣️ biohazard|toxic danger|биологическая опасность|токсично",
    "⬆️ up arrow|north top|стрелка вверх|вверх",
    "⬇️ down arrow|south bottom|стрелка вниз|вниз",
    "⬅️ left arrow|west back|стрелка влево|назад",
    "➡️ right arrow|east forward|стрелка вправо|вперёд",
    "↔️ left-right arrow|both sides|стрелка влево-вправо|обе стороны",
    "🔄 counterclockwise arrows|refresh sync|круговые стрелки|обновить синхронизация",
    "🔙 back arrow|return|назад|возврат",
    "🔝 top arrow|up best|наверх|топ",
    "🔀 shuffle tracks|random|перемешать|случайно",
    "🔁 repeat|loop again|повтор|цикл",
    "▶️ play button|start video|воспроизведение|старт",
    "⏸️ pause button|stop wait|пауза|остановка",
    "⏹️ stop button|end|стоп|конец",
    "⏭️ next track|skip forward|следующий трек|вперёд",
    "⏩ fast-forward|speed skip|перемотка вперёд|ускорение",
    "🔊 speaker high volume|loud sound|громкий звук|динамик",
    "🔇 muted speaker|silent mute|без звука|тишина",
    "📢 loudspeaker|announce shout|громкоговоритель|объявление",
    "🔔 bell|notification alert|колокольчик|уведомление",
    "🔕 bell with slash|mute silent|колокольчик перечёркнут|без уведомлений",
    "➕ plus|add more|плюс|добавить",
    "➖ minus|subtract less|минус|вычесть",
    "➗ divide|division math|деление|математика",
    "✖️ multiply|times math|умножение|математика",
    "♾️ infinity|forever endless|бесконечность|навсегда",
    "💲 heavy dollar sign|money price|знак доллара|цена",
    "™️ trade mark|brand|торговая марка|бренд",
    "©️ copyright|rights legal|копирайт|авторские права",
    "®️ registered|trademark legal|зарегистрированный знак|товарный знак",
    "🔴 red circle|record dot|красный круг|запись",
    "🟠 orange circle|dot|оранжевый круг|точка",
    "🟡 yellow circle|dot|жёлтый круг|точка",
    "🟢 green circle|online ok|зелёный круг|онлайн",
    "🔵 blue circle|dot|синий круг|точка",
    "🟣 purple circle|dot|фиолетовый круг|точка",
    "⚫ black circle|dot dark|чёрный круг|точка",
    "⚪ white circle|dot light|белый круг|точка",
    "🔺 red triangle pointed up|up increase|красный треугольник вверх|рост",
    "🔻 red triangle pointed down|down decrease|красный треугольник вниз|падение",
    "🔶 large orange diamond|shape|оранжевый ромб|фигура",
    "🔷 large blue diamond|shape|синий ромб|фигура",
    "⬛ black large square|shape|чёрный квадрат|фигура",
    "⬜ white large square|shape|белый квадрат|фигура",
    "🟥 red square|shape color|красный квадрат|цвет",
    "🟩 green square|shape color|зелёный квадрат|цвет",
    "🟦 blue square|shape color|синий квадрат|цвет",
    "♠️ spade suit|cards poker|пики|карты покер",
    "♥️ heart suit|cards poker|червы|карты покер",
    "♦️ diamond suit|cards poker|бубны|карты покер",
    "♣️ club suit|cards poker|трефы|карты покер",
    "🃏 joker|cards wild|джокер|карты",
    "♈ Aries|zodiac ram|Овен|зодиак",
    "♉ Taurus|zodiac bull|Телец|зодиак",
    "♊ Gemini|zodiac twins|Близнецы|зодиак",
    "♋ Cancer|zodiac crab|Рак|зодиак",
    "♌ Leo|zodiac lion|Лев|зодиак",
    "♍ Virgo|zodiac maiden|Дева|зодиак",
    "♎ Libra|zodiac scales|Весы|зодиак",
    "♏ Scorpio|zodiac scorpion|Скорпион|зодиак",
    "♐ Sagittarius|zodiac archer|Стрелец|зодиак",
    "♑ Capricorn|zodiac goat|Козерог|зодиак",
    "♒ Aquarius|zodiac water|Водолей|зодиак",
    "♓ Pisces|zodiac fish|Рыбы|зодиак",
    "🆕 NEW button|fresh|значок new|новое",
    "🆓 FREE button|no cost|значок free|бесплатно",
    "🆗 OK button|okay fine|значок ok|хорошо",
    "🔠 input latin uppercase|abc letters|латинские заглавные|буквы",
    "🔢 input numbers|1234 digits|цифры|числа",
    "⚛️ atom symbol|science physics|атом|физика наука",
    "☯️ yin yang|balance tao|инь-ян|баланс",
    "☮️ peace symbol|hippie|знак мира|пацифик",
    "⚜️ fleur-de-lis|french royal|королевская лилия|франция",
    "〰️ wavy dash|squiggle|волнистая линия|тильда",
  ],
  flags: [
    "🏁 chequered flag|finish race|клетчатый флаг|финиш гонка",
    "🚩 triangular flag|marker golf|треугольный флажок|метка",
    "🎌 crossed flags|japan celebration|скрещённые флаги|япония",
    "🏴 black flag|pirate dark|чёрный флаг|пиратский",
    "🏳️ white flag|surrender peace|белый флаг|капитуляция",
    "🏳️‍🌈 rainbow flag|pride lgbt|радужный флаг|прайд",
    "🏴‍☠️ pirate flag|jolly roger skull|пиратский флаг|весёлый роджер",
    "🇺🇸 flag United States|usa america|флаг США|америка",
    "🇬🇧 flag United Kingdom|uk britain england|флаг Великобритании|британия",
    "🇨🇦 flag Canada|canadian|флаг Канады|канада",
    "🇦🇺 flag Australia|aussie|флаг Австралии|австралия",
    "🇩🇪 flag Germany|german deutschland|флаг Германии|германия",
    "🇫🇷 flag France|french|флаг Франции|франция",
    "🇪🇸 flag Spain|spanish espana|флаг Испании|испания",
    "🇮🇹 flag Italy|italian italia|флаг Италии|италия",
    "🇵🇹 flag Portugal|portuguese|флаг Португалии|португалия",
    "🇳🇱 flag Netherlands|dutch holland|флаг Нидерландов|голландия",
    "🇧🇪 flag Belgium|belgian|флаг Бельгии|бельгия",
    "🇸🇪 flag Sweden|swedish|флаг Швеции|швеция",
    "🇳🇴 flag Norway|norwegian|флаг Норвегии|норвегия",
    "🇩🇰 flag Denmark|danish|флаг Дании|дания",
    "🇫🇮 flag Finland|finnish|флаг Финляндии|финляндия",
    "🇵🇱 flag Poland|polish|флаг Польши|польша",
    "🇨🇿 flag Czechia|czech|флаг Чехии|чехия",
    "🇦🇹 flag Austria|austrian|флаг Австрии|австрия",
    "🇨🇭 flag Switzerland|swiss|флаг Швейцарии|швейцария",
    "🇬🇷 flag Greece|greek|флаг Греции|греция",
    "🇹🇷 flag Turkey|turkish|флаг Турции|турция",
    "🇺🇦 flag Ukraine|ukrainian|флаг Украины|украина",
    "🇷🇺 flag Russia|russian|флаг России|россия",
    "🇰🇿 flag Kazakhstan|kazakh|флаг Казахстана|казахстан",
    "🇧🇾 flag Belarus|belarusian|флаг Беларуси|беларусь",
    "🇯🇵 flag Japan|japanese nippon|флаг Японии|япония",
    "🇨🇳 flag China|chinese|флаг Китая|китай",
    "🇰🇷 flag South Korea|korean|флаг Южной Кореи|корея",
    "🇮🇳 flag India|indian|флаг Индии|индия",
    "🇧🇷 flag Brazil|brazilian|флаг Бразилии|бразилия",
    "🇲🇽 flag Mexico|mexican|флаг Мексики|мексика",
    "🇦🇷 flag Argentina|argentinian|флаг Аргентины|аргентина",
    "🇿🇦 flag South Africa|african|флаг ЮАР|южная африка",
    "🇪🇬 flag Egypt|egyptian|флаг Египта|египет",
    "🇸🇦 flag Saudi Arabia|saudi|флаг Саудовской Аравии|саудовская аравия",
    "🇦🇪 flag United Arab Emirates|uae dubai|флаг ОАЭ|дубай эмираты",
    "🇮🇱 flag Israel|israeli|флаг Израиля|израиль",
    "🇹🇭 flag Thailand|thai|флаг Таиланда|таиланд",
    "🇻🇳 flag Vietnam|vietnamese|флаг Вьетнама|вьетнам",
    "🇮🇩 flag Indonesia|indonesian|флаг Индонезии|индонезия",
    "🇸🇬 flag Singapore|singaporean|флаг Сингапура|сингапур",
    "🇳🇿 flag New Zealand|kiwi|флаг Новой Зеландии|новая зеландия",
    "🇮🇪 flag Ireland|irish|флаг Ирландии|ирландия",
    "🇷🇴 flag Romania|romanian|флаг Румынии|румыния",
    "🇭🇺 flag Hungary|hungarian|флаг Венгрии|венгрия",
    "🇷🇸 flag Serbia|serbian|флаг Сербии|сербия",
    "🇱🇹 flag Lithuania|lithuanian|флаг Литвы|литва",
    "🇱🇻 flag Latvia|latvian|флаг Латвии|латвия",
    "🇪🇪 flag Estonia|estonian|флаг Эстонии|эстония",
  ],
};

function parseRow(row: string, group: EmojiGroupId): Emoji {
  const parts = row.split("|");
  const head = parts[0] ?? "";
  const space = head.indexOf(" ");
  const char = space === -1 ? head : head.slice(0, space);
  const name = space === -1 ? "" : head.slice(space + 1);

  return {
    char,
    name,
    nameRu: parts[2] ?? name,
    keywords: (parts[1] ?? "").split(" ").filter(Boolean),
    keywordsRu: (parts[3] ?? "").split(" ").filter(Boolean),
    group,
    tone: (parts[4] ?? "") === "t",
  };
}

export const EMOJI_LIST: Emoji[] = EMOJI_GROUPS.flatMap((g) =>
  RAW[g.id].map((row) => parseRow(row, g.id)),
);

const BY_CHAR = new Map<string, Emoji>(EMOJI_LIST.map((e) => [e.char, e]));

const TONE_RE = /\u{1F3FB}|\u{1F3FC}|\u{1F3FD}|\u{1F3FE}|\u{1F3FF}/gu;
const VARIATION_SELECTOR = "\uFE0F";

/** Remove any Fitzpatrick modifier from a character sequence. */
export function stripSkinTone(char: string): string {
  return char.replace(TONE_RE, "");
}

/**
 * Apply a Fitzpatrick modifier. The modifier belongs directly after the base
 * code point, which matters for ZWJ sequences such as 👩‍💻, and it replaces the
 * emoji presentation selector when one is present (✌️ + tone → ✌🏽).
 */
export function applySkinTone(char: string, tone: number): string {
  const base = stripSkinTone(char);
  const modifier = SKIN_TONE_MODIFIERS[tone] ?? "";
  if (!modifier) return base;

  const points = Array.from(base);
  if (points.length === 0) return base;

  // The modifier replaces only the FE0F right after the base; a later one belongs to another
  // ZWJ component (👩‍⚕️ ends in ⚕ + FE0F) and is part of the RGI sequence.
  const rest = points.slice(1);
  if (rest[0] === VARIATION_SELECTOR) rest.shift();
  return points[0] + modifier + rest.join("");
}

/** Human-readable code points, e.g. "U+1F469 U+200D U+1F4BB". */
export function toCodePoints(char: string): string {
  return Array.from(char)
    .map((p) => `U+${(p.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`)
    .join(" ");
}

/** Look up an emoji by character, with or without a skin-tone modifier. */
export function findEmoji(char: string): Emoji | undefined {
  return BY_CHAR.get(char) ?? BY_CHAR.get(stripSkinTone(char));
}

/**
 * Score of an emoji for a query: the sum over its words (`tokens`, each with how many
 * times it was typed) of how well the word matches, or -1 when one does not match.
 */
function scoreEmoji(
  emoji: Emoji,
  tokens: ReadonlyMap<string, number>,
  locale: EmojiLocale,
): number {
  const name = (locale === "ru" ? emoji.nameRu : emoji.name).toLowerCase();
  const nameWords = name.split(/[\s-]+/);
  const keywords = locale === "ru" ? emoji.keywordsRu : emoji.keywords;
  // The other language stays searchable — a Russian user typing "fire" should still find 🔥
  const altName = (locale === "ru" ? emoji.name : emoji.nameRu).toLowerCase();
  const altKeywords = locale === "ru" ? emoji.keywords : emoji.keywordsRu;

  let total = 0;

  for (const [token, count] of tokens) {
    let best = 0;

    if (name === token) best = 120;
    else if (name.startsWith(token)) best = 80;
    else if (nameWords.some((w) => w.startsWith(token))) best = 55;
    else if (name.includes(token)) best = 30;

    for (const kw of keywords) {
      if (kw === token) best = Math.max(best, 50);
      else if (kw.startsWith(token)) best = Math.max(best, 35);
      else if (kw.includes(token)) best = Math.max(best, 12);
    }

    if (best === 0) {
      if (altName.includes(token)) best = 20;
      else if (altKeywords.some((kw) => kw.startsWith(token))) best = 15;
    }

    if (best === 0) return -1;
    total += best * count;
  }

  return total;
}

export function searchEmoji(query: string, options: EmojiSearchOptions = {}): EmojiSearchResult {
  const locale: EmojiLocale = options.locale === "ru" ? "ru" : "en";
  const group = options.group && options.group !== "all" ? options.group : "all";
  const tone = Number.isFinite(options.tone) ? Math.min(5, Math.max(0, Number(options.tone))) : 0;
  const limit =
    options.limit && options.limit > 0 ? Math.floor(options.limit) : Number.MAX_SAFE_INTEGER;

  // A word typed twice counts twice, but is matched once: a pasted query of thousands of
  // repeated words costs no more than the distinct words in it.
  const tokens = new Map<string, number>();
  for (const token of query.toLowerCase().split(/\s+/)) {
    if (token) tokens.set(token, (tokens.get(token) ?? 0) + 1);
  }
  const pool = group === "all" ? EMOJI_LIST : EMOJI_LIST.filter((e) => e.group === group);

  let matched: Emoji[];

  if (tokens.size === 0) {
    matched = pool;
  } else {
    const scored: { emoji: Emoji; score: number; index: number }[] = [];
    pool.forEach((emoji, index) => {
      const score = scoreEmoji(emoji, tokens, locale);
      if (score >= 0) scored.push({ emoji, score, index });
    });
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    matched = scored.map((s) => s.emoji);
  }

  const items = matched.slice(0, limit).map((emoji) => ({
    char: emoji.tone ? applySkinTone(emoji.char, tone) : emoji.char,
    base: emoji.char,
    name: locale === "ru" ? emoji.nameRu : emoji.name,
    group: emoji.group,
    tone: emoji.tone,
  }));

  return { items, total: matched.length, query, group };
}
