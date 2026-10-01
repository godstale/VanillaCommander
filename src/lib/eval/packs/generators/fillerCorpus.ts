// Self-authored neutral filler corpus for the long-context generator.
// Every paragraph is fictional (invented towns, everyday processes, nature
// vignettes) so nothing here is fact-questionable. Paragraphs are assembled
// deterministically from the template pools below; the trailing marker line
// keeps each entry unique.

const KO_CITIES = [
  '달빛시',
  '솔바람마을',
  '은하강변도시',
  '구름다리마을',
  '별빛항구',
  '안개숲마을',
  '새벽빛도시',
  '호수별마을',
  '바람결도시',
  '달맞이마을',
  '은모래도시',
  '푸른언덕마을',
  '별하늘도시',
  '아침안개마을',
  '노을빛항구',
  '잔물결마을',
  '달그림자도시',
  '솔숲마을',
  '은빛강마을',
  '별샘도시',
];

const KO_TOPICS = [
  '등대 관리',
  '빵 굽기',
  '다리 점검',
  '정원 가꾸기',
  '도서관 정리',
  '시장 운영',
  '우편 배달',
  '축제 준비',
  '배 수리',
  '차 재배',
  '도자기 굽기',
  '종이 만들기',
  '등산로 정비',
  '운하 청소',
  '시계 수리',
  '천연 염색',
  '양봉',
  '버섯 재배',
  '대나무 공예',
  '소금 만들기',
];

const KO_A = [
  '아침 안개가 걷히면 {city}의 은빛 강줄기가 드러나고 강변 산책로를 따라 주민들이 가벼운 산책을 즐긴다.',
  '{city}에서는 매년 가을마다 강변 축제가 열리고 이웃들이 모여 음식을 나누며 밤늦도록 이야기를 나눈다.',
  '{city}의 오래된 등대는 이제 박물관으로 바뀌어 아이들에게 항구의 역사를 알려주는 배움터가 되었다.',
  '봄이 오면 {city}의 언덕마다 야생화가 피고 바람을 따라 꽃향기가 골목골목 퍼져 나간다.',
  '{city}의 중앙 시장에서는 새벽부터 상인들이 좌판을 펴고 신선한 채소와 과일을 손님들에게 권한다.',
  '겨울밤이면 {city}의 창문마다 따뜻한 불빛이 켜지고 골목에서는 구운 밤 냄새가 은은하게 풍긴다.',
  '{city}의 도서관은 백 년 된 은행나무 아래에 자리 잡고 있어 독서하기 좋은 그늘을 제공한다.',
  '비가 온 뒤 {city}의 돌다리 위에는 무지개가 자주 뜨고 아이들은 다리 위에서 사진을 찍는다.',
];

const KO_B = [
  '이 마을 사람들은 {topic} 일을 대대로 이어오며 매주 수요일마다 모여 기술과 경험을 서로 나눈다.',
  '{topic} 작업은 새벽 일찍 시작되어 정오가 되기 전에 마무리되며 오후에는 도구 손질과 기록 정리를 한다.',
  '젊은 견습생들은 {topic} 장인의 지도 아래 세 단계 과정을 마쳐야 비로소 독립적인 작업 자격을 얻는다.',
  '{topic}에 필요한 재료는 이웃 마을과의 물물교환으로 구하고 품질 검사는 두 사람이 함께 확인한다.',
  '마을 회의에서는 {topic} 일정이 분기마다 조정되고 성수기에는 인력을 추가로 모집하여 대응한다.',
  '{topic} 작업장 옆에는 작은 휴게실이 있어 일꾼들이 차를 마시며 잠시 쉬어갈 수 있다.',
  '오래된 {topic} 도구는 마을 박물관에 전시되어 방문객들에게 제작 과정의 변천사를 보여준다.',
  '{topic} 결과물은 매월 첫째 토요일 장터에 출품되고 수익금 일부는 마을 기금으로 적립된다.',
];

const KO_C = [
  '강변 버드나무 아래에서는 물총새가 먹이를 찾고 가끔씩 물수리가 하늘 높이 원을 그리며 난다.',
  '숲속 오솔길 옆에는 이끼 낀 돌무더기가 있고 이른 아침에는 사슴 발자국이 선명하게 남는다.',
  '호수 표면에는 아침 이슬을 머금은 연꽃이 피고 개구리 울음소리가 해 질 녘까지 이어진다.',
  '언덕 위 전망대에서는 마을 전체가 내려다보이고 맑은 날에는 먼 바다의 수평선까지 보인다.',
  '가을 바람이 불면 은행잎이 노랗게 물들어 골목이 황금빛 융단처럼 변하는 장관을 이룬다.',
  '봄비 내린 뒤 숲에서는 송이버섯과 목이버섯이 올라오고 주민들은 바구니를 들고 나물을 캔다.',
  '밤하늘에는 별이 빼곡히 떠서 은하수가 강물에 비치고 반딧불이가 풀밭 사이를 오간다.',
  '겨울 호수는 얇게 얼어붙어 아이들의 썰매장이 되고 어른들은 얼음낚시 채비를 서두른다.',
];

const KO_D = [
  '우체부 할아버지는 삼십 년째 같은 길을 걸으며 편지와 함께 계절 소식을 주민들에게 전한다.',
  '빵집 아주머니는 새벽 네 시에 일어나 첫 빵을 굽고 갓 구운 빵 냄새로 골목을 깨운다.',
  '학교 앞 문구점에서는 방과 후 아이들이 모여 그림을 그리고 서로의 숙제를 도와준다.',
  '마을 이발소 의자에서는 동네 소식이 오가고 손님들은 차를 마시며 차례를 기다린다.',
  '저녁이면 공터에 모인 주민들이 배드민턴을 치고 아이들은 숨바꼭질을 하며 시간을 보낸다.',
  '주말마다 열리는 벼룩시장에서는 헌책과 장난감이 주인을 바꾸며 새로운 이야기를 만든다.',
  '마을 합창단은 매주 금요일 저녁에 모여 연습하고 명절 공연을 목표로 화음을 맞춘다.',
  '경로당 앞 평상에서는 어르신들이 장기를 두며 지나가는 사람들에게 인사를 건넨다.',
];

const KO_E = [
  '이렇게 소소한 하루가 쌓여 마을의 역사가 되고 주민들은 그 기록을 자랑스럽게 여긴다.',
  '바쁜 일상 속에서도 이웃과 나누는 작은 인사가 이 마을을 따뜻하게 만드는 힘이다.',
  '계절이 바뀔 때마다 마을 풍경도 달라지지만 서로 돕는 마음만은 한결같이 이어진다.',
  '오늘의 평범한 풍경이 내일의 소중한 추억이 된다는 것을 주민들은 이미 잘 알고 있다.',
  '작은 마을의 느린 시간이야말로 바쁜 세상에서 잊고 있던 여유를 되찾게 해준다.',
  '이웃의 안부를 묻는 짧은 대화가 모여 마을 전체를 잇는 보이지 않는 다리가 된다.',
  '하루를 마무리하는 종소리가 울리면 골목마다 불빛이 켜지고 평온한 밤이 찾아온다.',
  '다음 날 아침이면 또 새로운 이야기가 시작되리라는 기대 속에 마을은 잠이 든다.',
];

const KO_F = [
  '장터 한쪽에서는 갓 구운 호떡과 붕어빵을 파는 노점이 길게 늘어서 아이들의 발길을 붙잡는다.',
  '마을 공방에서는 매주 토요일마다 도자기 체험 교실이 열리고 초보자도 작은 찻잔을 완성한다.',
  '가을걷이가 끝나면 주민들이 모여 김장을 담그고 커다란 가마솥에 수육을 삶아 나눈다.',
  '강변 카페에서는 직접 볶은 원두로 내린 커피를 팔고 창가 자리에서는 낚시하는 모습이 보인다.',
  '봄나물 축제가 열리면 달래와 냉이 비빔밥이 장터의 별미로 등장해 방문객의 입맛을 사로잡는다.',
  '마을 양조장에서는 찹쌀로 빚은 막걸리를 숙성시키고 명절마다 시음 행사를 열어 호평을 받는다.',
  '겨울 간식으로는 군고구마와 어묵 국물이 인기여서 포장마차 앞에는 항상 줄이 길게 이어진다.',
  '여름이면 수박 화채와 콩국수가 별미로 꼽히고 평상 아래에서는 어른들이 돗자리를 편다.',
];

const KO_G = [
  '마을 방송실에서는 매일 아침 여덟 시에 오늘의 날씨와 장터 소식을 스피커로 알려준다.',
  '청년회는 매월 마지막 주 일요일에 하천 정화 활동을 하고 참여한 가게에 감사 스티커를 준다.',
  '마을 금고에서는 소액 대출과 장학 사업을 함께 운영하여 주민들의 생활을 든든히 뒷받침한다.',
  '방범대는 밤 열 시부터 두 시간씩 조를 짜서 골목을 순찰하고 가로등 고장을 신고한다.',
  '도서관 자원봉사자들은 매주 화요일에 그림책 읽어주기 모임을 열어 아이들과 부모를 맞이한다.',
  '마을 공지 게시판에는 분실물 소식과 일손 돕기 요청이 올라와 이웃들이 빠르게 해결해 준다.',
  '경로당에서는 매주 목요일마다 건강 체조 교실이 열리고 간호사 봉사자가 혈압을 재준다.',
  '어린이집 앞 건널목에서는 녹색 어머니회가 등하교 시간마다 교통 지도를 맡아 안전을 지킨다.',
];

const EN_CITIES = [
  'Moonlight Harbor',
  'Pinewind Village',
  'Silverriver City',
  'Cloudbridge Town',
  'Starbay Port',
  'Mistforest Village',
  'Dawnlight City',
  'Lakestar Town',
  'Breezhollow',
  'Moonrise Village',
  'Silverdune City',
  'Greenhill Town',
  'Starmere City',
  'Morningmist Village',
  'Sunsetquay Port',
  'Ripplebrook',
  'Moonshadow City',
  'Pinegrove',
  'Silverbrook',
  'Starspring',
];

const EN_TOPICS = [
  'lighthouse keeping',
  'bread baking',
  'bridge inspection',
  'gardening',
  'library organizing',
  'market running',
  'mail delivery',
  'festival preparation',
  'boat repair',
  'tea growing',
  'pottery firing',
  'papermaking',
  'trail maintenance',
  'canal cleaning',
  'clock repair',
  'natural dyeing',
  'beekeeping',
  'mushroom farming',
  'bamboo craft',
  'salt making',
];

const EN_A = [
  'When the morning fog lifts, the silver river running through {city} sparkles brightly under the early sun.',
  'Every autumn {city} holds a riverside festival where neighbors share food and stories late into the night.',
  'The old lighthouse in {city} is now a small museum where visiting children learn about harbor history.',
  'In spring the hills around {city} bloom with wildflowers, and their gentle scent drifts through every alley.',
  'At the central market of {city}, vendors set up their stalls at dawn and offer fresh vegetables to visitors.',
  'On cold winter nights every window in {city} glows warm, and the smell of roasted chestnuts fills the lanes.',
  'The public library of {city} stands beneath a hundred-year-old ginkgo tree that shades all its readers.',
  'After heavy rain a rainbow often arches over the stone bridge of {city}, and children gather for pictures.',
];

const EN_B = [
  'The people here have practiced {topic} for many generations and meet each Wednesday to share their skills.',
  'Work on {topic} starts early at dawn and finishes well before noon, followed by tool care and record keeping.',
  'Young apprentices study under a master of {topic} through three clear stages before working on their own.',
  'Materials for {topic} arrive through barter with nearby villages, and two people always verify the quality.',
  'The village council adjusts the {topic} schedule every quarter and recruits extra hands in busy seasons.',
  'Beside the {topic} workshop stands a small rest room where workers pause for hot tea during the day.',
  'Old tools once used for {topic} rest in the village museum, showing visitors how methods changed over time.',
  'Finished pieces from {topic} appear at the monthly market, and part of the earnings funds village projects.',
];

const EN_C = [
  'Kingfishers hunt for small fish beneath the riverside willows while an osprey sometimes circles high above.',
  'Mossy stones line the quiet forest path, and on early mornings clear deer tracks mark the soft ground.',
  'Lotus flowers holding drops of morning dew bloom on the lake as frog songs continue until the sunset hour.',
  'From the wooden lookout on the hill the whole village lies below, and on clear days the distant sea appears.',
  'When the autumn winds arrive the ginkgo leaves turn a deep gold, and the lanes look warmly carpeted.',
  'After the spring rain mushrooms rise across the forest floor, and villagers carry baskets out for greens.',
  'At night dense stars crowd the dark sky, the bright milky way mirrors on the river, and fireflies drift past.',
  'In deep winter the lake freezes thin for sledding children while the adults prepare their ice fishing gear.',
];

const EN_D = [
  'The old mail carrier has walked the very same route for thirty years, delivering letters and seasonal news.',
  'The village baker rises at four each morning, and the warm smell of fresh bread wakes the sleepy lane.',
  'After classes end, children gather at the small stationery shop to draw pictures and share their homework.',
  'Local news travels fast inside the village barbershop, where waiting customers sip tea and trade kind greetings.',
  'In the cool evening neighbors play badminton on the open lot while children run about playing hide and seek.',
  'At the weekend flea market old books and toys change owners, and each small object begins a new story.',
  'The village choir meets every Friday evening to rehearse its harmonies for the coming holiday performance.',
  'On the long bench before the senior hall, the elders play board games and greet everyone passing by.',
];

const EN_E = [
  'Quiet days like these slowly pile up into village history, and the residents treasure every recorded page.',
  'Even amid the busiest routines, the small greetings shared with neighbors keep this village warm and close.',
  'The surrounding scenery changes with every season, yet the habit of helping one another never truly changes.',
  'The residents already understand that an ordinary view today becomes a precious memory tomorrow or later.',
  'The slow unhurried hours of a small village return the sense of leisure that the hurried world forgets.',
  'Short friendly chats asking after neighbors form an invisible bridge that quietly connects the whole village.',
  'When the evening bell closes another day, lamps light up along the lanes and a calm night arrives.',
  'With quiet hope that a fresh story starts again next morning, the village gently falls into peaceful sleep.',
];

function fill(template: string, city: string, topic: string): string {
  return template.split('{city}').join(city).split('{topic}').join(topic);
}

function buildKoParagraphs(): string[] {
  const out: string[] = [];
  for (let i = 0; i < 120; i++) {
    const city = KO_CITIES[i % KO_CITIES.length];
    const topic = KO_TOPICS[(i * 7 + 3) % KO_TOPICS.length];
    const parts = [
      fill(KO_A[(i * 3 + 1) % KO_A.length], city, topic),
      fill(KO_B[(i * 5 + 2) % KO_B.length], city, topic),
      fill(KO_C[(i * 7 + 4) % KO_C.length], city, topic),
      fill(KO_D[(i * 11 + 3) % KO_D.length], city, topic),
      fill(KO_E[(i * 13 + 5) % KO_E.length], city, topic),
      fill(KO_F[(i * 17 + 2) % KO_F.length], city, topic),
      fill(KO_G[(i * 19 + 6) % KO_G.length], city, topic),
      `이 글은 달빛 기록 보관소의 제${i + 1}번째 이야기이다.`,
    ];
    out.push(parts.join(' '));
  }
  return out;
}

function buildEnParagraphs(): string[] {
  const out: string[] = [];
  for (let i = 0; i < 80; i++) {
    const city = EN_CITIES[i % EN_CITIES.length];
    const topic = EN_TOPICS[(i * 7 + 3) % EN_TOPICS.length];
    const parts = [
      fill(EN_A[(i * 3 + 1) % EN_A.length], city, topic),
      fill(EN_B[(i * 5 + 2) % EN_B.length], city, topic),
      fill(EN_C[(i * 7 + 4) % EN_C.length], city, topic),
      fill(EN_D[(i * 11 + 3) % EN_D.length], city, topic),
      fill(EN_E[(i * 13 + 5) % EN_E.length], city, topic),
      `This text is entry number ${i + 1} in the Moonlight Archive collection.`,
    ];
    out.push(parts.join(' '));
  }
  return out;
}

export const KO_PARAGRAPHS: string[] = buildKoParagraphs();
export const EN_PARAGRAPHS: string[] = buildEnParagraphs();
