// Leitura do cupom fiscal (NFC-e) do Paraná, sem acesso ao banco (testável à parte).
// O QR Code do cupom leva a uma página pública da Fazenda com os itens; aqui lemos essa página.

export type NfceItem = {
  description: string;
  code: string;
  qty: number;
  unit: string;
  unitPrice: number;
  total: number;
};

export type Nfce = {
  key: string; // chave de acesso (44 números)
  supplierName: string;
  document: string; // CNPJ só com números
  address: string;
  number: string;
  series: string;
  emission: string | null; // AAAA-MM-DD
  total: number;
  payments: { method: string; amount: number }[];
  items: NfceItem[];
};

// Aceita o link do QR Code, o texto lido do QR ou só a chave.
export function parseNfceInput(text: string): { url: string | null; key: string | null } {
  const clean = text.trim();
  const fromUrl = clean.match(/[?&]p=([^&\s]+)/i);
  if (fromUrl) {
    const p = decodeURIComponent(fromUrl[1]);
    const key = p.split("|")[0].replace(/\D/g, "");
    return { url: clean.replace(/^http:\/\//i, "https://"), key: key.length === 44 ? key : null };
  }
  const digits = clean.replace(/\D/g, "");
  return { url: null, key: digits.length === 44 ? digits : null };
}

const decodeEntities = (text: string) =>
  text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");
const strip = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const brl = (text: string) => {
  const value = Number(text.replace(/[^\d,-]/g, "").replace(",", "."));
  return Number.isFinite(value) ? value : 0;
};

export function parseNfcePrHtml(html: string): Nfce {
  const items: NfceItem[] = [];
  const rows = html.split(/<tr\s+id="Item/i).slice(1);
  for (const row of rows) {
    const body = row.split(/<\/tr>/i)[0];
    const pick = (cls: string) => body.match(new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)</span>`, "i"))?.[1] || "";
    const description = strip(pick("txtTit2"));
    const code = strip(pick("RCod")).replace(/\D/g, "");
    const qty = brl(strip(pick("Rqtd")).replace(/Qtde\.?:/i, ""));
    const unit = strip(pick("RUN")).replace(/UN:\s*/i, "").toUpperCase();
    const unitPrice = brl(strip(pick("RvlUnit")).replace(/Vl\. Unit\.?:/i, ""));
    const total = brl(strip(pick("valor")));
    if (description && total > 0) items.push({ description, code, qty: qty || 1, unit, unitPrice: unitPrice || total / (qty || 1), total });
  }

  const supplierName = strip(html.match(/class="txtTopo"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");
  const texts = Array.from(html.matchAll(/<div class="text">([\s\S]*?)<\/div>/gi)).map((m) => strip(m[1]));
  const document = (texts.find((t) => /CNPJ/i.test(t)) || "").replace(/\D/g, "");
  const address = texts.find((t) => !/CNPJ/i.test(t)) || "";
  const flat = strip(html);
  const number = flat.match(/N[úu�]mero:\s*(\d+)/i)?.[1] || "";
  const series = flat.match(/S[ée�]rie:\s*(\d+)/i)?.[1] || "";
  const em = flat.match(/Emiss[ãa�]o:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  const key = (html.match(/class="chave"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "").replace(/\D/g, "");

  // Total e formas de pagamento (bloco "totalNota").
  const totalBlock = html.split(/id="totalNota"/i)[1]?.split(/id="infos"/i)[0] || "";
  const lines = Array.from(totalBlock.matchAll(/<label[^>]*>([\s\S]*?)<\/label>\s*<span[^>]*>([\s\S]*?)<\/span>/gi)).map((m) => ({
    label: strip(m[1]),
    value: strip(m[2]),
  }));
  const total = brl(lines.find((l) => /Valor a pagar/i.test(l.label))?.value || "");
  const start = lines.findIndex((l) => /Forma de pagamento/i.test(l.label));
  const payments = start >= 0
    ? lines.slice(start + 1).filter((l) => !/Tributos|Troco/i.test(l.label) && brl(l.value) > 0).map((l) => ({ method: l.label, amount: brl(l.value) }))
    : [];

  return {
    key,
    supplierName,
    document,
    address,
    number,
    series,
    emission: em ? `${em[3]}-${em[2]}-${em[1]}` : null,
    total: total || Math.round(items.reduce((sum, item) => sum + item.total, 0) * 100) / 100,
    payments,
    items,
  };
}

// Código do produto na loja; sem código, a descrição (sem acento e minúscula).
export function productKey(item: Pick<NfceItem, "code" | "description">) {
  if (item.code) return `c:${item.code}`;
  return `d:${item.description.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim()}`;
}
