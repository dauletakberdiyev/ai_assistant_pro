export type MuftyatCity = {
  id: number;
  title: string;
  lng: string;
  lat: string;
  timezone: string;
  region: string | null;
  district: string | null;
  distance: number | null;
};

export type SalahPrayerName = "Fajr" | "Sunrise" | "Dhuhr" | "Asr" | "Maghrib" | "Isha";

export type MuftyatDayTimes = Record<SalahPrayerName, string> & {
  date: string;
};

export type MuftyatYearTimes = {
  success: boolean;
  result: MuftyatDayTimes[];
  latitude: number;
  longitude: number;
  year: number;
  city_name: string;
  timezone: string;
};

type FetchLike = typeof fetch;

function assertOk(response: Response, url: string) {
  if (!response.ok) {
    throw new Error(`Muftyat API request failed with ${response.status}: ${url}`);
  }
}

function parseJsonObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Unexpected ${label} response shape`);
  }
  return value as Record<string, unknown>;
}

function parseCity(value: unknown): MuftyatCity {
  const city = parseJsonObject(value, "city");
  return {
    id: Number(city.id),
    title: String(city.title),
    lng: String(city.lng),
    lat: String(city.lat),
    timezone: String(city.timezone),
    region: city.region === null || city.region === undefined ? null : String(city.region),
    district: city.district === null || city.district === undefined ? null : String(city.district),
    distance: city.distance === null || city.distance === undefined ? null : Number(city.distance)
  };
}

export async function searchMuftyatCities(
  cityName: string,
  fetchImpl: FetchLike = fetch
): Promise<MuftyatCity[]> {
  const query = cityName.trim();
  if (!query) throw new Error("City name is required");

  const url = `https://api.muftyat.kz/cities/?search=${encodeURIComponent(query)}&format=json`;
  const response = await fetchImpl(url);
  assertOk(response, url);
  const body = parseJsonObject(await response.json(), "cities");
  const results = Array.isArray(body.results) ? body.results : [];
  return results.map(parseCity).filter((city) => Number.isFinite(city.id));
}

function parseDayTimes(value: unknown): MuftyatDayTimes {
  const day = parseJsonObject(value, "salah day");
  return {
    date: String(day.date),
    Fajr: String(day.Fajr ?? "").trim(),
    Sunrise: String(day.Sunrise ?? "").trim(),
    Dhuhr: String(day.Dhuhr ?? "").trim(),
    Asr: String(day.Asr ?? "").trim(),
    Maghrib: String(day.Maghrib ?? "").trim(),
    Isha: String(day.Isha ?? "").trim()
  };
}

export async function fetchMuftyatSalahTimes(
  input: { year: number; latitude: string; longitude: string },
  fetchImpl: FetchLike = fetch
): Promise<MuftyatYearTimes> {
  const url = `https://namaz.muftyat.kz/kk/api/times/${input.year}/${input.latitude}/${input.longitude}`;
  const response = await fetchImpl(url);
  assertOk(response, url);
  const body = parseJsonObject(await response.json(), "salah times");
  const result = Array.isArray(body.result) ? body.result.map(parseDayTimes) : [];

  return {
    success: Boolean(body.success),
    result,
    latitude: Number(body.latitude),
    longitude: Number(body.longitude),
    year: Number(body.year),
    city_name: String(body.city_name ?? ""),
    timezone: String(body.timezone ?? "")
  };
}
