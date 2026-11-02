// Regras de acesso, sem dependências de servidor (usadas também pelo proxy).
// Só o dono entra: e-mail autorizado + verificação em duas etapas (app autenticador).
export function emailAutorizado(email: unknown) {
  const permitidos = (process.env.DONO_EMAIL || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return typeof email === "string" && permitidos.includes(email.toLowerCase());
}

export function sessaoCompleta(claims: Record<string, unknown> | null | undefined) {
  if (testeLocalSemLogin()) return true;
  return Boolean(claims && claims.aal === "aal2" && emailAutorizado(claims.email));
}

// Só para testes neste computador (npm run dev + variável no .env.local).
// Nunca vale no site publicado: lá o sistema roda sempre em modo de produção.
export function testeLocalSemLogin() {
  return process.env.NODE_ENV === "development" && process.env.TESTE_LOCAL_SEM_LOGIN === "1";
}
