import campusFallback from '../assets/campus-hero-fallback.png';
import campusHeritage from '../assets/campus-heroes/campus-heritage-ginkgo.png';
import campusLakeside from '../assets/campus-heroes/campus-lakeside.png';
import campusModern from '../assets/campus-heroes/campus-modern-library.png';

const HEROES = [campusHeritage, campusModern, campusLakeside, campusFallback];

const HERO_BY_UNIVERSITY = {
  清华大学: campusHeritage,
  北京大学: campusLakeside,
  中央民族大学: campusHeritage,
  中国人民大学: campusHeritage,
  北京航空航天大学: campusModern,
  北京理工大学: campusModern,
  复旦大学: campusLakeside,
  同济大学: campusModern,
  上海交通大学: campusModern,
  浙江大学: campusLakeside,
  南京大学: campusHeritage,
  东南大学: campusModern,
  武汉大学: campusLakeside,
  华中科技大学: campusModern,
  中山大学: campusLakeside,
  厦门大学: campusLakeside,
  四川大学: campusHeritage,
  电子科技大学: campusModern,
  西安交通大学: campusHeritage,
  西北工业大学: campusModern,
};

const HERO_BY_PROVINCE = {
  北京: campusHeritage,
  上海: campusLakeside,
  江苏: campusModern,
  浙江: campusLakeside,
  湖北: campusLakeside,
  湖南: campusHeritage,
  广东: campusLakeside,
  福建: campusLakeside,
  四川: campusHeritage,
  陕西: campusHeritage,
  重庆: campusModern,
};

function stableIndex(input) {
  return Array.from(input || '').reduce((total, char) => (total * 31 + char.codePointAt(0)) >>> 0, 7) % HEROES.length;
}

/** 离线校园图：优先院校/省份主题，其他院校稳定分配到本地图集。 */
export function getCampusHero(uni) {
  if (!uni) return campusFallback;
  return HERO_BY_UNIVERSITY[uni.name] || HERO_BY_PROVINCE[uni.province] || HEROES[stableIndex(`${uni.name}-${uni.province}`)];
}
