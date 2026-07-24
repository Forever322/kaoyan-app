/**
 * 院校静态基础信息库
 * 包含: 院校名称、省份、城市、A/B区、层次
 *
 * A区: 北京 天津 河北 山西 辽宁 吉林 黑龙江 上海 江苏 浙江
 *      安徽 福建 江西 山东 河南 湖北 湖南 广东 重庆 四川 陕西
 * B区: 内蒙古 广西 海南 贵州 云南 西藏 甘肃 青海 宁夏 新疆
 */

const UNIVERSITIES = [
  // ==================== 北京 (A区) ====================
  { name: '北京大学',            province: '北京', city: '北京', zone: 'A', level: '985' },
  { name: '清华大学',            province: '北京', city: '北京', zone: 'A', level: '985' },
  { name: '中国人民大学',        province: '北京', city: '北京', zone: 'A', level: '985' },
  { name: '北京航空航天大学',    province: '北京', city: '北京', zone: 'A', level: '985' },
  { name: '北京理工大学',        province: '北京', city: '北京', zone: 'A', level: '985' },
  { name: '中国农业大学',        province: '北京', city: '北京', zone: 'A', level: '985' },
  { name: '北京师范大学',        province: '北京', city: '北京', zone: 'A', level: '985' },
  { name: '中央民族大学',        province: '北京', city: '北京', zone: 'A', level: '985' },
  { name: '北京交通大学',        province: '北京', city: '北京', zone: 'A', level: '211' },
  { name: '北京工业大学',        province: '北京', city: '北京', zone: 'A', level: '211' },
  { name: '北京科技大学',        province: '北京', city: '北京', zone: 'A', level: '211' },
  { name: '北京化工大学',        province: '北京', city: '北京', zone: 'A', level: '211' },
  { name: '北京邮电大学',        province: '北京', city: '北京', zone: 'A', level: '211' },
  { name: '北京林业大学',        province: '北京', city: '北京', zone: 'A', level: '211' },
  { name: '北京协和医学院',      province: '北京', city: '北京', zone: 'A', level: '双一流' },
  { name: '北京中医药大学',      province: '北京', city: '北京', zone: 'A', level: '211' },
  { name: '北京外国语大学',      province: '北京', city: '北京', zone: 'A', level: '211' },
  { name: '中国传媒大学',        province: '北京', city: '北京', zone: 'A', level: '211' },
  { name: '中央财经大学',        province: '北京', city: '北京', zone: 'A', level: '211' },
  { name: '对外经济贸易大学',    province: '北京', city: '北京', zone: 'A', level: '211' },
  { name: '中国政法大学',        province: '北京', city: '北京', zone: 'A', level: '211' },
  { name: '华北电力大学',        province: '北京', city: '北京', zone: 'A', level: '211' },
  { name: '中国地质大学(北京)',  province: '北京', city: '北京', zone: 'A', level: '211' },
  { name: '中国矿业大学(北京)',  province: '北京', city: '北京', zone: 'A', level: '211' },
  { name: '中国石油大学(北京)',  province: '北京', city: '北京', zone: 'A', level: '211' },
  { name: '中国科学院大学',      province: '北京', city: '北京', zone: 'A', level: '双一流' },
  { name: '首都师范大学',        province: '北京', city: '北京', zone: 'A', level: '双一流' },
  { name: '北京体育大学',        province: '北京', city: '北京', zone: 'A', level: '211' },

  // ==================== 天津 (A区) ====================
  { name: '南开大学',            province: '天津', city: '天津', zone: 'A', level: '985' },
  { name: '天津大学',            province: '天津', city: '天津', zone: 'A', level: '985' },
  { name: '天津医科大学',        province: '天津', city: '天津', zone: 'A', level: '211' },
  { name: '河北工业大学',        province: '天津', city: '天津', zone: 'A', level: '211' },
  { name: '天津工业大学',        province: '天津', city: '天津', zone: 'A', level: '双一流' },

  // ==================== 河北 (A区) ====================
  { name: '燕山大学',            province: '河北', city: '秦皇岛', zone: 'A', level: '双非' },
  { name: '河北大学',            province: '河北', city: '保定', zone: 'A', level: '双非' },
  { name: '华北理工大学',        province: '河北', city: '唐山', zone: 'A', level: '双非' },

  // ==================== 山西 (A区) ====================
  { name: '太原理工大学',        province: '山西', city: '太原', zone: 'A', level: '211' },
  { name: '山西大学',            province: '山西', city: '太原', zone: 'A', level: '双一流' },

  // ==================== 辽宁 (A区) ====================
  { name: '大连理工大学',        province: '辽宁', city: '大连', zone: 'A', level: '985' },
  { name: '东北大学',            province: '辽宁', city: '沈阳', zone: 'A', level: '985' },
  { name: '辽宁大学',            province: '辽宁', city: '沈阳', zone: 'A', level: '211' },
  { name: '大连海事大学',        province: '辽宁', city: '大连', zone: 'A', level: '211' },
  { name: '东北财经大学',        province: '辽宁', city: '大连', zone: 'A', level: '双非' },

  // ==================== 吉林 (A区) ====================
  { name: '吉林大学',            province: '吉林', city: '长春', zone: 'A', level: '985' },
  { name: '东北师范大学',        province: '吉林', city: '长春', zone: 'A', level: '211' },
  { name: '延边大学',            province: '吉林', city: '延边', zone: 'A', level: '211' },

  // ==================== 黑龙江 (A区) ====================
  { name: '哈尔滨工业大学',      province: '黑龙江', city: '哈尔滨', zone: 'A', level: '985' },
  { name: '哈尔滨工程大学',      province: '黑龙江', city: '哈尔滨', zone: 'A', level: '211' },
  { name: '东北林业大学',        province: '黑龙江', city: '哈尔滨', zone: 'A', level: '211' },
  { name: '东北农业大学',        province: '黑龙江', city: '哈尔滨', zone: 'A', level: '211' },

  // ==================== 上海 (A区) ====================
  { name: '复旦大学',            province: '上海', city: '上海', zone: 'A', level: '985' },
  { name: '上海交通大学',        province: '上海', city: '上海', zone: 'A', level: '985' },
  { name: '同济大学',            province: '上海', city: '上海', zone: 'A', level: '985' },
  { name: '华东师范大学',        province: '上海', city: '上海', zone: 'A', level: '985' },
  { name: '华东理工大学',        province: '上海', city: '上海', zone: 'A', level: '211' },
  { name: '东华大学',            province: '上海', city: '上海', zone: 'A', level: '211' },
  { name: '上海外国语大学',      province: '上海', city: '上海', zone: 'A', level: '211' },
  { name: '上海财经大学',        province: '上海', city: '上海', zone: 'A', level: '211' },
  { name: '上海大学',            province: '上海', city: '上海', zone: 'A', level: '211' },
  { name: '华东政法大学',        province: '上海', city: '上海', zone: 'A', level: '双非' },

  // ==================== 江苏 (A区) ====================
  { name: '南京大学',            province: '江苏', city: '南京', zone: 'A', level: '985' },
  { name: '东南大学',            province: '江苏', city: '南京', zone: 'A', level: '985' },
  { name: '南京航空航天大学',    province: '江苏', city: '南京', zone: 'A', level: '211' },
  { name: '南京理工大学',        province: '江苏', city: '南京', zone: 'A', level: '211' },
  { name: '中国矿业大学',        province: '江苏', city: '徐州', zone: 'A', level: '211' },
  { name: '河海大学',            province: '江苏', city: '南京', zone: 'A', level: '211' },
  { name: '江南大学',            province: '江苏', city: '无锡', zone: 'A', level: '211' },
  { name: '南京农业大学',        province: '江苏', city: '南京', zone: 'A', level: '211' },
  { name: '中国药科大学',        province: '江苏', city: '南京', zone: 'A', level: '211' },
  { name: '南京师范大学',        province: '江苏', city: '南京', zone: 'A', level: '211' },
  { name: '苏州大学',            province: '江苏', city: '苏州', zone: 'A', level: '211' },
  { name: '南京信息工程大学',    province: '江苏', city: '南京', zone: 'A', level: '双一流' },
  { name: '南京邮电大学',        province: '江苏', city: '南京', zone: 'A', level: '双一流' },

  // ==================== 浙江 (A区) ====================
  { name: '浙江大学',            province: '浙江', city: '杭州', zone: 'A', level: '985' },
  { name: '浙江工业大学',        province: '浙江', city: '杭州', zone: 'A', level: '双非' },
  { name: '宁波大学',            province: '浙江', city: '宁波', zone: 'A', level: '双一流' },
  { name: '杭州电子科技大学',    province: '浙江', city: '杭州', zone: 'A', level: '双非' },

  // ==================== 安徽 (A区) ====================
  { name: '中国科学技术大学',    province: '安徽', city: '合肥', zone: 'A', level: '985' },
  { name: '合肥工业大学',        province: '安徽', city: '合肥', zone: 'A', level: '211' },
  { name: '安徽大学',            province: '安徽', city: '合肥', zone: 'A', level: '211' },

  // ==================== 福建 (A区) ====================
  { name: '厦门大学',            province: '福建', city: '厦门', zone: 'A', level: '985' },
  { name: '福州大学',            province: '福建', city: '福州', zone: 'A', level: '211' },

  // ==================== 江西 (A区) ====================
  { name: '南昌大学',            province: '江西', city: '南昌', zone: 'A', level: '211' },
  { name: '江西财经大学',        province: '江西', city: '南昌', zone: 'A', level: '双非' },

  // ==================== 山东 (A区) ====================
  { name: '山东大学',            province: '山东', city: '济南', zone: 'A', level: '985' },
  { name: '中国海洋大学',        province: '山东', city: '青岛', zone: 'A', level: '985' },
  { name: '中国石油大学(华东)',  province: '山东', city: '青岛', zone: 'A', level: '211' },

  // ==================== 河南 (A区) ====================
  { name: '郑州大学',            province: '河南', city: '郑州', zone: 'A', level: '211' },
  { name: '河南大学',            province: '河南', city: '开封', zone: 'A', level: '双一流' },

  // ==================== 湖北 (A区) ====================
  { name: '武汉大学',            province: '湖北', city: '武汉', zone: 'A', level: '985' },
  { name: '华中科技大学',        province: '湖北', city: '武汉', zone: 'A', level: '985' },
  { name: '武汉理工大学',        province: '湖北', city: '武汉', zone: 'A', level: '211' },
  { name: '中国地质大学(武汉)',  province: '湖北', city: '武汉', zone: 'A', level: '211' },
  { name: '华中农业大学',        province: '湖北', city: '武汉', zone: 'A', level: '211' },
  { name: '华中师范大学',        province: '湖北', city: '武汉', zone: 'A', level: '211' },
  { name: '中南财经政法大学',    province: '湖北', city: '武汉', zone: 'A', level: '211' },
  { name: '武汉科技大学',        province: '湖北', city: '武汉', zone: 'A', level: '双非' },

  // ==================== 湖南 (A区) ====================
  { name: '中南大学',            province: '湖南', city: '长沙', zone: 'A', level: '985' },
  { name: '湖南大学',            province: '湖南', city: '长沙', zone: 'A', level: '985' },
  { name: '国防科技大学',        province: '湖南', city: '长沙', zone: 'A', level: '985' },
  { name: '湘潭大学',            province: '湖南', city: '湘潭', zone: 'A', level: '双一流' },

  // ==================== 广东 (A区) ====================
  { name: '中山大学',            province: '广东', city: '广州', zone: 'A', level: '985' },
  { name: '华南理工大学',        province: '广东', city: '广州', zone: 'A', level: '985' },
  { name: '暨南大学',            province: '广东', city: '广州', zone: 'A', level: '211' },
  { name: '华南师范大学',        province: '广东', city: '广州', zone: 'A', level: '211' },
  { name: '深圳大学',            province: '广东', city: '深圳', zone: 'A', level: '双非' },
  { name: '南方科技大学',        province: '广东', city: '深圳', zone: 'A', level: '双一流' },
  { name: '广州大学',            province: '广东', city: '广州', zone: 'A', level: '双非' },
  { name: '广东工业大学',        province: '广东', city: '广州', zone: 'A', level: '双非' },

  // ==================== 重庆 (A区) ====================
  { name: '重庆大学',            province: '重庆', city: '重庆', zone: 'A', level: '985' },
  { name: '西南大学',            province: '重庆', city: '重庆', zone: 'A', level: '211' },
  { name: '西南政法大学',        province: '重庆', city: '重庆', zone: 'A', level: '双非' },
  { name: '重庆邮电大学',        province: '重庆', city: '重庆', zone: 'A', level: '双非' },

  // ==================== 四川 (A区) ====================
  { name: '四川大学',            province: '四川', city: '成都', zone: 'A', level: '985' },
  { name: '电子科技大学',        province: '四川', city: '成都', zone: 'A', level: '985' },
  { name: '西南交通大学',        province: '四川', city: '成都', zone: 'A', level: '211' },
  { name: '西南财经大学',        province: '四川', city: '成都', zone: 'A', level: '211' },
  { name: '四川农业大学',        province: '四川', city: '雅安', zone: 'A', level: '211' },
  { name: '成都理工大学',        province: '四川', city: '成都', zone: 'A', level: '双一流' },

  // ==================== 陕西 (A区) ====================
  { name: '西安交通大学',        province: '陕西', city: '西安', zone: 'A', level: '985' },
  { name: '西北工业大学',        province: '陕西', city: '西安', zone: 'A', level: '985' },
  { name: '西北农林科技大学',    province: '陕西', city: '杨凌', zone: 'A', level: '985' },
  { name: '西安电子科技大学',    province: '陕西', city: '西安', zone: 'A', level: '211' },
  { name: '长安大学',            province: '陕西', city: '西安', zone: 'A', level: '211' },
  { name: '陕西师范大学',        province: '陕西', city: '西安', zone: 'A', level: '211' },
  { name: '西北大学',            province: '陕西', city: '西安', zone: 'A', level: '211' },

  // ==================== 内蒙古 (B区) ====================
  { name: '内蒙古大学',          province: '内蒙古', city: '呼和浩特', zone: 'B', level: '211' },

  // ==================== 广西 (B区) ====================
  { name: '广西大学',            province: '广西', city: '南宁', zone: 'B', level: '211' },

  // ==================== 海南 (B区) ====================
  { name: '海南大学',            province: '海南', city: '海口', zone: 'B', level: '211' },

  // ==================== 贵州 (B区) ====================
  { name: '贵州大学',            province: '贵州', city: '贵阳', zone: 'B', level: '211' },

  // ==================== 云南 (B区) ====================
  { name: '云南大学',            province: '云南', city: '昆明', zone: 'B', level: '211' },
  { name: '昆明理工大学',        province: '云南', city: '昆明', zone: 'B', level: '双非' },

  // ==================== 西藏 (B区) ====================
  { name: '西藏大学',            province: '西藏', city: '拉萨', zone: 'B', level: '211' },

  // ==================== 甘肃 (B区) ====================
  { name: '兰州大学',            province: '甘肃', city: '兰州', zone: 'B', level: '985' },
  { name: '西北师范大学',        province: '甘肃', city: '兰州', zone: 'B', level: '双非' },

  // ==================== 青海 (B区) ====================
  { name: '青海大学',            province: '青海', city: '西宁', zone: 'B', level: '211' },

  // ==================== 宁夏 (B区) ====================
  { name: '宁夏大学',            province: '宁夏', city: '银川', zone: 'B', level: '211' },

  // ==================== 新疆 (B区) ====================
  { name: '新疆大学',            province: '新疆', city: '乌鲁木齐', zone: 'B', level: '211' },
  { name: '石河子大学',          province: '新疆', city: '石河子', zone: 'B', level: '211' }
];

/** 按分区筛选院校 */
function getUniversitiesByZone(zone) {
  if (zone === 'all' || !zone) return UNIVERSITIES;
  return UNIVERSITIES.filter(u => u.zone === zone);
}

/** 按名称查找院校 */
function findUniversity(name) {
  return UNIVERSITIES.find(u => u.name === name);
}

/** 搜索院校 (模糊匹配) */
function searchUniversities(query) {
  const q = query.toLowerCase().trim();
  if (!q) return UNIVERSITIES;
  return UNIVERSITIES.filter(u =>
    u.name.toLowerCase().includes(q) ||
    u.province.toLowerCase().includes(q) ||
    (u.city && u.city.toLowerCase().includes(q))
  );
}
