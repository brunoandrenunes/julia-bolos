"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { marcarLogin } from "@/lib/sessao-navegador";

type Etapa = "carregando" | "senha" | "codigo" | "cadastro" | "negado";

export default function LoginPage() {
  const [supabase] = useState(() => createSupabaseBrowser());
  const [etapa, setEtapa] = useState<Etapa>("carregando");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [segredo, setSegredo] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  // Depois da senha: pede o código do autenticador ou, no primeiro acesso, cadastra o app.
  async function seguirParaSegundaEtapa() {
    const { data: nivel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (nivel?.currentLevel === "aal2") {
      // Sessão completa, mas o servidor recusou: e-mail sem autorização.
      setEtapa("negado");
      return;
    }

    const { data: fatores, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;
    const verificado = fatores.totp.find((fator) => fator.status === "verified");
    if (verificado) {
      setFactorId(verificado.id);
      setEtapa("codigo");
      return;
    }

    // Remove cadastros que ficaram pela metade antes de gerar um novo QR code.
    for (const fator of fatores.all.filter((item) => item.status !== "verified")) {
      await supabase.auth.mfa.unenroll({ factorId: fator.id });
    }
    const { data: novo, error: erroCadastro } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Autenticador",
    });
    if (erroCadastro) throw erroCadastro;
    setFactorId(novo.id);
    setQrCode(novo.totp.qr_code);
    setSegredo(novo.totp.secret);
    setEtapa("cadastro");
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        setEtapa("senha");
        return;
      }
      try {
        await seguirParaSegundaEtapa();
      } catch {
        setEtapa("senha");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function entrarComSenha(event: React.FormEvent) {
    event.preventDefault();
    setErro("");
    setOcupado(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
      if (error) {
        setErro("E-mail ou senha incorretos.");
        return;
      }
      setSenha("");
      await seguirParaSegundaEtapa();
    } catch {
      setErro("Não foi possível entrar. Tente novamente.");
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarCodigo(event: React.FormEvent) {
    event.preventDefault();
    setErro("");
    setOcupado(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: codigo.trim() });
      if (error) {
        setErro("Código inválido. Confira o app autenticador e tente de novo.");
        return;
      }
      marcarLogin();
      window.location.href = "/";
    } finally {
      setOcupado(false);
    }
  }

  async function sair() {
    await supabase.auth.signOut();
    setEtapa("senha");
    setCodigo("");
  }

  return (
    <main className="login-page">
      <div className="login-card form-card">
        <div className="brand" style={{ marginBottom: 20 }}>
          <div className="brand-mark">JR</div>
          <div>
            <h2>Julia Ronsoni Bolos</h2>
            <p>Acesso restrito</p>
          </div>
        </div>

        {etapa === "carregando" ? <p className="muted">Carregando…</p> : null}

        {etapa === "senha" ? (
          <form className="login-form" onSubmit={entrarComSenha}>
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="senha">Senha</label>
              <input id="senha" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
            </div>
            <button className="button" type="submit" disabled={ocupado}>
              {ocupado ? "Entrando…" : "Entrar"}
            </button>
          </form>
        ) : null}

        {etapa === "cadastro" ? (
          <form className="login-form" onSubmit={confirmarCodigo}>
            <p>
              Primeiro acesso: abra o app autenticador no celular (Google Authenticator, Microsoft
              Authenticator ou similar), escolha adicionar conta e leia o QR code abaixo.
            </p>
            {qrCode ? <img className="login-qr" src={qrCode} alt="QR code para o app autenticador" /> : null}
            <p className="muted" style={{ wordBreak: "break-all" }}>
              Se não conseguir ler, digite este código no app: <strong>{segredo}</strong>
            </p>
            <div className="field">
              <label htmlFor="codigo">Código de 6 dígitos mostrado no app</label>
              <input id="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={codigo} onChange={(e) => setCodigo(e.target.value)} />
            </div>
            <button className="button" type="submit" disabled={ocupado}>
              Confirmar e entrar
            </button>
          </form>
        ) : null}

        {etapa === "codigo" ? (
          <form className="login-form" onSubmit={confirmarCodigo}>
            <div className="field">
              <label htmlFor="codigo">Código do app autenticador</label>
              <input id="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required autoFocus value={codigo} onChange={(e) => setCodigo(e.target.value)} />
            </div>
            <button className="button" type="submit" disabled={ocupado}>
              Entrar
            </button>
            <button className="secondary-button" type="button" onClick={sair}>
              Usar outro e-mail
            </button>
          </form>
        ) : null}

        {etapa === "negado" ? (
          <div className="login-form">
            <p>Este usuário não tem acesso ao sistema.</p>
            <button className="secondary-button" type="button" onClick={sair}>
              Sair
            </button>
          </div>
        ) : null}

        {erro ? <p className="login-error">{erro}</p> : null}
      </div>
    </main>
  );
}
