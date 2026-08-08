export type SessionClientMetadata = {
  deviceLabel: string;
  approximateLocation: string;
  capturedAt: string;
};

type RequestCfLocation = {
  city?: unknown;
  region?: unknown;
  country?: unknown;
};

const META_PREFIX = 'session_client_meta:';

const CHINA_REGION_LABELS: Record<string, string> = {
  anhui: '安徽省', beijing: '北京市', chongqing: '重庆市', fujian: '福建省', gansu: '甘肃省',
  guangdong: '广东省', guangxi: '广西壮族自治区', guizhou: '贵州省', hainan: '海南省', hebei: '河北省',
  heilongjiang: '黑龙江省', henan: '河南省', hubei: '湖北省', hunan: '湖南省', inner_mongolia: '内蒙古自治区',
  jiangsu: '江苏省', jiangxi: '江西省', jilin: '吉林省', liaoning: '辽宁省', ningxia: '宁夏回族自治区',
  qinghai: '青海省', shaanxi: '陕西省', shandong: '山东省', shanghai: '上海市', shanxi: '山西省',
  sichuan: '四川省', tianjin: '天津市', tibet: '西藏自治区', xinjiang: '新疆维吾尔自治区', yunnan: '云南省',
  zhejiang: '浙江省', hong_kong: '香港特别行政区', macao: '澳门特别行政区',
};

const CHINA_CITY_LABELS: Record<string, string> = {
  beijing: '北京市', shanghai: '上海市', tianjin: '天津市', chongqing: '重庆市',
  hangzhou: '杭州市', jiaxing: '嘉兴市', ningbo: '宁波市', wenzhou: '温州市', shaoxing: '绍兴市',
  guangzhou: '广州市', shenzhen: '深圳市', dongguan: '东莞市', foshan: '佛山市', zhuhai: '珠海市',
  nanjing: '南京市', suzhou: '苏州市', wuxi: '无锡市', changzhou: '常州市',
  chengdu: '成都市', wuhan: '武汉市', changsha: '长沙市', chenzhou: '郴州市', zhengzhou: '郑州市',
  xian: '西安市', qingdao: '青岛市', jinan: '济南市', hefei: '合肥市', fuzhou: '福州市', xiamen: '厦门市',
};

function cleanPart(value: unknown, maxLength = 80) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizedPlaceKey(value: unknown) {
  return cleanPart(value).toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '');
}

function browserLabel(userAgent: string) {
  if (/MicroMessenger\//i.test(userAgent)) return '微信内置浏览器';
  if (/(?:EdgA|EdgiOS|Edg)\//i.test(userAgent)) return 'Edge 浏览器';
  if (/(?:Firefox|FxiOS)\//i.test(userAgent)) return 'Firefox 浏览器';
  if (/(?:Chrome|CriOS)\//i.test(userAgent)) return 'Chrome 浏览器';
  if (/Version\/[\d.]+.*Safari/i.test(userAgent)) return 'Safari 浏览器';
  return '';
}

function platformLabel(userAgent: string) {
  if (/iPhone/i.test(userAgent)) return 'iPhone';
  if (/iPad/i.test(userAgent)) return 'iPad';
  if (/Android/i.test(userAgent)) return '安卓设备';
  if (/Windows NT/i.test(userAgent)) return 'Windows 电脑';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'Mac 电脑';
  if (/Linux/i.test(userAgent)) return 'Linux 设备';
  return '';
}

export function deviceLabelFromUserAgent(value: unknown) {
  const userAgent = cleanPart(value, 512);
  if (!userAgent) return '';
  const platform = platformLabel(userAgent);
  const browser = browserLabel(userAgent);
  return [platform, browser].filter(Boolean).join(' · ').slice(0, 120);
}

function chineseCountryLabel(countryCode: string) {
  if (!/^[A-Za-z]{2}$/.test(countryCode)) return '';
  try {
    return new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(countryCode.toUpperCase()) || '';
  } catch {
    return countryCode.toUpperCase() === 'CN' ? '中国' : '';
  }
}

export function approximateLocationFromCf(value: unknown) {
  const cf = value && typeof value === 'object' && !Array.isArray(value)
    ? value as RequestCfLocation
    : {};
  const countryCode = cleanPart(cf.country, 16).toUpperCase();
  const country = chineseCountryLabel(countryCode);

  // For mainland China, only show city/province names when there is an explicit mapping.
  // Unknown English place names are omitted instead of transliterated or guessed.
  if (countryCode === 'CN') {
    const city = CHINA_CITY_LABELS[normalizedPlaceKey(cf.city)] || '';
    const region = CHINA_REGION_LABELS[normalizedPlaceKey(cf.region)] || '';
    const ordered = [city, region, country || '中国'].filter(Boolean);
    return ordered.filter((part, index) => ordered.indexOf(part) === index).join(' · ').slice(0, 160);
  }

  // Outside China, country is the only value that can be translated reliably without
  // maintaining a speculative city/region dictionary.
  return country.slice(0, 160);
}

export function sessionClientMetadataKey(sessionId: string) {
  return `${META_PREFIX}${String(sessionId || '').trim()}`;
}

export function sessionIdFromClientMetadataKey(key: string) {
  return key.startsWith(META_PREFIX) ? key.slice(META_PREFIX.length) : '';
}

export function clientMetadataFromRequest(req: Request, capturedAt = new Date().toISOString()): SessionClientMetadata {
  const cf = (req as Request & { cf?: RequestCfLocation }).cf;
  return {
    deviceLabel: deviceLabelFromUserAgent(req.headers.get('user-agent') || ''),
    approximateLocation: approximateLocationFromCf(cf),
    capturedAt,
  };
}
