// Tema escolhido pelo usuário. Padrão: claro; "auto" segue o aparelho.
export const THEME_KEY = "bolos.tema";

// Aplica o tema guardado antes da página aparecer (evita piscar). Vai inline no <head>.
export const themeBootScript = `(function(){var t="light";try{t=localStorage.getItem("${THEME_KEY}")||"light"}catch(e){}if(t!=="auto")document.documentElement.dataset.theme=t==="dark"?"dark":"light"})()`;
