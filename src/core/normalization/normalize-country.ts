import type { Normalized, NormalizedCountry } from './normalization-types';
import { aliasKey, normalizeText } from './normalize-text';

/**
 * Internal country table: [ISO 3166-1 alpha-2, canonical name, ...aliases].
 * Aliases are matched on aliasKey() (lower-case, no dots/diacritics, no
 * leading "the"), so "U.S.A.", "usa" and "The Netherlands" all resolve.
 *
 * Ambiguous names are deliberately NOT aliased: bare "Congo" (two countries)
 * and bare "Korea" (two countries). Cities (e.g. "Dubai") are not countries
 * and are never mapped. Extend this table; do not add external data.
 */
const COUNTRIES: ReadonlyArray<readonly [string, string, ...string[]]> = [
  ['US', 'United States', 'USA', 'US', 'United States of America', 'America', 'U S A'],
  [
    'GB',
    'United Kingdom',
    'UK',
    'Great Britain',
    'Britain',
    'England',
    'Scotland',
    'Wales',
    'Northern Ireland',
  ],
  ['AE', 'United Arab Emirates', 'UAE', 'Emirates'],
  ['AF', 'Afghanistan'],
  ['AL', 'Albania'],
  ['DZ', 'Algeria'],
  ['AO', 'Angola'],
  ['AR', 'Argentina'],
  ['AM', 'Armenia'],
  ['AU', 'Australia'],
  ['AT', 'Austria'],
  ['AZ', 'Azerbaijan'],
  ['BS', 'Bahamas'],
  ['BH', 'Bahrain'],
  ['BD', 'Bangladesh'],
  ['BB', 'Barbados'],
  ['BY', 'Belarus'],
  ['BE', 'Belgium'],
  ['BZ', 'Belize'],
  ['BJ', 'Benin'],
  ['BT', 'Bhutan'],
  ['BO', 'Bolivia'],
  ['BA', 'Bosnia and Herzegovina', 'Bosnia'],
  ['BW', 'Botswana'],
  ['BR', 'Brazil', 'Brasil'],
  ['BN', 'Brunei', 'Brunei Darussalam'],
  ['BG', 'Bulgaria'],
  ['BF', 'Burkina Faso'],
  ['BI', 'Burundi'],
  ['KH', 'Cambodia'],
  ['CM', 'Cameroon'],
  ['CA', 'Canada'],
  ['CV', 'Cape Verde', 'Cabo Verde'],
  ['CL', 'Chile'],
  ['CN', 'China', "People's Republic of China", 'PRC'],
  ['CO', 'Colombia'],
  ['CD', 'Democratic Republic of the Congo', 'DR Congo', 'DRC', 'Congo-Kinshasa', 'Congo Kinshasa'],
  ['CG', 'Republic of the Congo', 'Congo-Brazzaville', 'Congo Brazzaville'],
  ['CR', 'Costa Rica'],
  ['CI', "Côte d'Ivoire", 'Ivory Coast', "Cote d'Ivoire"],
  ['HR', 'Croatia'],
  ['CU', 'Cuba'],
  ['CY', 'Cyprus'],
  ['CZ', 'Czechia', 'Czech Republic'],
  ['DK', 'Denmark'],
  ['DJ', 'Djibouti'],
  ['DO', 'Dominican Republic'],
  ['EC', 'Ecuador'],
  ['EG', 'Egypt'],
  ['SV', 'El Salvador'],
  ['GQ', 'Equatorial Guinea'],
  ['ER', 'Eritrea'],
  ['EE', 'Estonia'],
  ['SZ', 'Eswatini', 'Swaziland'],
  ['ET', 'Ethiopia'],
  ['FJ', 'Fiji'],
  ['FI', 'Finland'],
  ['FR', 'France'],
  ['GA', 'Gabon'],
  ['GM', 'Gambia'],
  ['GE', 'Georgia'],
  ['DE', 'Germany', 'Deutschland'],
  ['GH', 'Ghana'],
  ['GR', 'Greece'],
  ['GT', 'Guatemala'],
  ['GN', 'Guinea'],
  ['GW', 'Guinea-Bissau', 'Guinea Bissau'],
  ['GY', 'Guyana'],
  ['HT', 'Haiti'],
  ['HN', 'Honduras'],
  ['HK', 'Hong Kong'],
  ['HU', 'Hungary'],
  ['IS', 'Iceland'],
  ['IN', 'India'],
  ['ID', 'Indonesia'],
  ['IR', 'Iran'],
  ['IQ', 'Iraq'],
  ['IE', 'Ireland', 'Republic of Ireland'],
  ['IL', 'Israel'],
  ['IT', 'Italy'],
  ['JM', 'Jamaica'],
  ['JP', 'Japan'],
  ['JO', 'Jordan'],
  ['KZ', 'Kazakhstan'],
  ['KE', 'Kenya'],
  ['KW', 'Kuwait'],
  ['KG', 'Kyrgyzstan'],
  ['LA', 'Laos'],
  ['LV', 'Latvia'],
  ['LB', 'Lebanon'],
  ['LS', 'Lesotho'],
  ['LR', 'Liberia'],
  ['LY', 'Libya'],
  ['LT', 'Lithuania'],
  ['LU', 'Luxembourg'],
  ['MO', 'Macau', 'Macao'],
  ['MG', 'Madagascar'],
  ['MW', 'Malawi'],
  ['MY', 'Malaysia'],
  ['MV', 'Maldives'],
  ['ML', 'Mali'],
  ['MT', 'Malta'],
  ['MR', 'Mauritania'],
  ['MU', 'Mauritius'],
  ['MX', 'Mexico'],
  ['MD', 'Moldova'],
  ['MN', 'Mongolia'],
  ['ME', 'Montenegro'],
  ['MA', 'Morocco'],
  ['MZ', 'Mozambique'],
  ['MM', 'Myanmar', 'Burma'],
  ['NA', 'Namibia'],
  ['NP', 'Nepal'],
  ['NL', 'Netherlands', 'Holland'],
  ['NZ', 'New Zealand'],
  ['NI', 'Nicaragua'],
  ['NE', 'Niger'],
  ['NG', 'Nigeria'],
  ['KP', 'North Korea', "Democratic People's Republic of Korea", 'DPRK'],
  ['MK', 'North Macedonia', 'Macedonia'],
  ['NO', 'Norway'],
  ['OM', 'Oman'],
  ['PK', 'Pakistan'],
  ['PS', 'Palestine'],
  ['PA', 'Panama'],
  ['PG', 'Papua New Guinea'],
  ['PY', 'Paraguay'],
  ['PE', 'Peru'],
  ['PH', 'Philippines'],
  ['PL', 'Poland'],
  ['PT', 'Portugal'],
  ['PR', 'Puerto Rico'],
  ['QA', 'Qatar'],
  ['RO', 'Romania'],
  ['RU', 'Russia', 'Russian Federation'],
  ['RW', 'Rwanda'],
  ['SA', 'Saudi Arabia', 'KSA', 'Kingdom of Saudi Arabia'],
  ['SN', 'Senegal'],
  ['RS', 'Serbia'],
  ['SC', 'Seychelles'],
  ['SL', 'Sierra Leone'],
  ['SG', 'Singapore'],
  ['SK', 'Slovakia'],
  ['SI', 'Slovenia'],
  ['SO', 'Somalia'],
  ['ZA', 'South Africa', 'RSA'],
  ['KR', 'South Korea', 'Republic of Korea'],
  ['SS', 'South Sudan'],
  ['ES', 'Spain'],
  ['LK', 'Sri Lanka'],
  ['SD', 'Sudan'],
  ['SR', 'Suriname'],
  ['SE', 'Sweden'],
  ['CH', 'Switzerland'],
  ['SY', 'Syria'],
  ['TW', 'Taiwan'],
  ['TJ', 'Tajikistan'],
  ['TZ', 'Tanzania'],
  ['TH', 'Thailand'],
  ['TG', 'Togo'],
  ['TT', 'Trinidad and Tobago', 'Trinidad & Tobago'],
  ['TN', 'Tunisia'],
  ['TR', 'Turkey', 'Türkiye', 'Turkiye'],
  ['TM', 'Turkmenistan'],
  ['UG', 'Uganda'],
  ['UA', 'Ukraine'],
  ['UY', 'Uruguay'],
  ['UZ', 'Uzbekistan'],
  ['VE', 'Venezuela'],
  ['VN', 'Vietnam', 'Viet Nam'],
  ['YE', 'Yemen'],
  ['ZM', 'Zambia'],
  ['ZW', 'Zimbabwe'],
];

interface CountryEntry {
  readonly code: string;
  readonly name: string;
}

function buildIndex(): ReadonlyMap<string, CountryEntry> {
  const index = new Map<string, CountryEntry>();
  for (const [code, name, ...aliases] of COUNTRIES) {
    const entry = { code, name };
    for (const alias of [name, ...aliases]) {
      const key = aliasKey(alias);
      if (key === null) continue;
      const existing = index.get(key);
      if (existing && existing.code !== code) {
        throw new Error(`Country alias "${alias}" maps to both ${existing.code} and ${code}`);
      }
      index.set(key, entry);
    }
  }
  return index;
}

const INDEX = buildIndex();

const BY_CODE: ReadonlyMap<string, CountryEntry> = new Map(
  COUNTRIES.map(([code, name]) => [code, { code, name }] as const),
);

/** ISO 3166-1 alpha-2 lookup ("GB" → United Kingdom). Case-insensitive. */
export function countryByCode(code: string): { code: string; name: string } | null {
  return BY_CODE.get(code.trim().toUpperCase()) ?? null;
}

/** Number of alias keys (names + aliases) in the table. */
export const COUNTRY_ALIAS_COUNT = INDEX.size;
export const COUNTRY_COUNT = COUNTRIES.length;

/**
 * USA / United States / U.S.A. → { normalized: "United States", code: "US" }.
 * Unknown text is kept (cleaned) with code null and a warning; never rejected.
 */
export function normalizeCountry(raw: string | null): Normalized<NormalizedCountry> {
  const cleaned = normalizeText(raw);
  if (cleaned === null) return { value: { raw, normalized: null, code: null }, warnings: [] };
  const entry = INDEX.get(aliasKey(cleaned) ?? '');
  if (entry) return { value: { raw, normalized: entry.name, code: entry.code }, warnings: [] };
  return {
    value: { raw, normalized: cleaned, code: null },
    warnings: ['country: not in alias map'],
  };
}
