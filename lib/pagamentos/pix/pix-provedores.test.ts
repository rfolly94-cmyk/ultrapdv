import assert from "node:assert/strict";
import { test } from "node:test";

import { coletarNovosSegredosDoFormulario } from "./coletar-segredos";
import {
  filtrarCredenciaisDoProvedor,
  flagsCredenciaisParaCliente,
  integracaoPublicaParaCliente,
  mesclarSegredosProvedor,
  validarCredenciaisDoProvedor,
} from "./credenciais";
import { formularioCredenciaisProvedor } from "./formulario-provedor";
import { montarPayloadCobrancaPix } from "./montar-payload";
import {
  PROVEDORES_PIX_GERANET,
  PROVEDORES_PIX_SELECIONAVEIS,
  ambientesSuportadosDoProvedor,
  filtrarSegredosPorNamespace,
  nomeSegredoBancario,
  prefixoSegredosProvedor,
  provedoresPixGeranet,
} from "./provedores-geranet";
import { payloadSemCredenciais, sanitizarRespostaPix } from "./sanitizar";

const CHAVES_EFI = [
  "clienteId",
  "clienteSegredo",
  "certificadoPfxHexadecimal",
  "senhaCertificadoPfx",
];
const CHAVES_SICREDI = [
  "clienteId",
  "clienteSegredo",
  "certificadoPemHexadecimal",
  "chavePrivadaPemHexadecimal",
];
const CHAVES_INTER = [
  "clienteId",
  "clienteSegredo",
  "certificadoPemHexadecimal",
  "chavePrivadaPemHexadecimal",
];

const misturado = {
  clienteId: "id-efi",
  clienteSegredo: "secret-efi",
  certificadoPfxHexadecimal: "aabbcc",
  senhaCertificadoPfx: "senha-efi",
  certificadoPemHexadecimal: "ddeeff",
  chavePrivadaPemHexadecimal: "112233",
  tokenAcesso: "token-mp",
  chavePix: "chave-publica",
};

test("1. selecionar Sicredi gera campos Sicredi", () => {
  const form = formularioCredenciaisProvedor("sicredi");
  assert.equal(form.titulo, "Credenciais Sicredi");
  assert.deepEqual(
    form.campos.map((campo) => campo.chave),
    CHAVES_SICREDI
  );
  assert.equal(form.configuracaoDisponivel, true);
});

test("2. selecionar Efí gera campos Efí", () => {
  const form = formularioCredenciaisProvedor("efibank");
  assert.equal(form.titulo, "Credenciais Efí Bank");
  assert.deepEqual(
    form.campos.map((campo) => campo.chave),
    CHAVES_EFI
  );
});

test("3. selecionar Inter gera campos Inter", () => {
  const form = formularioCredenciaisProvedor("inter");
  assert.equal(form.titulo, "Credenciais Banco Inter");
  assert.deepEqual(
    form.campos.map((campo) => campo.chave),
    CHAVES_INTER
  );
});

test("4. Efí não recebe secrets Sicredi", () => {
  const credenciais = filtrarCredenciaisDoProvedor(
    "efibank",
    misturado,
    "chave-publica"
  );
  assert.equal(credenciais.certificadoPemHexadecimal, undefined);
  assert.equal(credenciais.chavePrivadaPemHexadecimal, undefined);
  assert.equal(credenciais.certificadoPfxHexadecimal, "aabbcc");
});

test("5. Sicredi não recebe secrets Efí", () => {
  const credenciais = filtrarCredenciaisDoProvedor(
    "sicredi",
    misturado,
    "chave-publica"
  );
  assert.equal(credenciais.certificadoPfxHexadecimal, undefined);
  assert.equal(credenciais.senhaCertificadoPfx, undefined);
  assert.equal(credenciais.certificadoPemHexadecimal, "ddeeff");
});

test("6. homologação não lê segredo de produção", () => {
  const empresaId = "emp-1";
  const vault = {
    [nomeSegredoBancario({
      empresaId,
      provedor: "sicredi",
      ambiente: "1",
      campo: "clienteSegredo",
    })]: "secret-producao",
    [nomeSegredoBancario({
      empresaId,
      provedor: "sicredi",
      ambiente: "2",
      campo: "clienteSegredo",
    })]: "secret-homolog",
  };

  const homolog = filtrarSegredosPorNamespace(
    vault,
    prefixoSegredosProvedor({
      empresaId,
      provedor: "sicredi",
      ambiente: "2",
    })
  );

  assert.equal(homolog.clienteSegredo, "secret-homolog");
  assert.equal(Object.keys(homolog).length, 1);
});

test("7. produção não lê segredo de homologação", () => {
  const empresaId = "emp-1";
  const vault = {
    [nomeSegredoBancario({
      empresaId,
      provedor: "sicredi",
      ambiente: "1",
      campo: "clienteId",
    })]: "id-producao",
    [nomeSegredoBancario({
      empresaId,
      provedor: "sicredi",
      ambiente: "2",
      campo: "clienteId",
    })]: "id-homolog",
  };

  const producao = filtrarSegredosPorNamespace(
    vault,
    prefixoSegredosProvedor({
      empresaId,
      provedor: "sicredi",
      ambiente: "1",
    })
  );

  assert.equal(producao.clienteId, "id-producao");
  assert.notEqual(producao.clienteId, "id-homolog");
});

test("8. payload contém somente campos daquele provedor", () => {
  const credenciais = filtrarCredenciaisDoProvedor(
    "sicredi",
    misturado,
    "chave-publica"
  );
  const payload = montarPayloadCobrancaPix({
    ambiente: "2",
    provedor: "sicredi",
    cnpj: "12345678000190",
    credenciais,
    recebedor: {
      nome: "Empresa Teste",
      cep: "78000000",
      cidade: "Cuiabá",
      uf: "MT",
    },
    cobranca: { valor: 1 },
  });

  assert.deepEqual(Object.keys(payload.credenciais).sort(), [
    "certificadoPemHexadecimal",
    "chavePix",
    "chavePrivadaPemHexadecimal",
    "clienteId",
    "clienteSegredo",
  ]);
});

test("9. campos vazios são removidos", () => {
  const credenciais = filtrarCredenciaisDoProvedor(
    "efibank",
    {
      clienteId: "cli",
      clienteSegredo: "   ",
      certificadoPfxHexadecimal: "",
      senhaCertificadoPfx: null,
    },
    "chave-publica"
  );

  assert.equal(credenciais.clienteId, "cli");
  assert.equal(credenciais.chavePix, "chave-publica");
  assert.equal(credenciais.clienteSegredo, undefined);
  assert.equal(credenciais.certificadoPfxHexadecimal, undefined);
  assert.equal(credenciais.senhaCertificadoPfx, undefined);
});

test("10. segredo existente não é apagado quando formulário vier vazio", () => {
  const mesclado = mesclarSegredosProvedor({
    provedor: "sicredi",
    ambiente: "2",
    novos: { clienteId: "", clienteSegredo: "" },
    existentes: {
      clienteId: "id-salvo",
      clienteSegredo: "secret-salvo",
    },
  });

  assert.equal(mesclado.clienteId, "id-salvo");
  assert.equal(mesclado.clienteSegredo, "secret-salvo");
});

test("11. certificados nunca retornam para Client Component", () => {
  const publico = integracaoPublicaParaCliente({
    provedor: "efibank",
    ambiente: "2",
    chave_pix: "minha-chave",
    recebedor_nome: "Empresa",
    recebedor_cep: "78000000",
    recebedor_cidade: "Cuiabá",
    recebedor_uf: "MT",
    credenciais_configuradas: true,
    certificado_configurado: true,
    configuracao_publica: {
      credenciais: {
        efibank: {
          "2": {
            clienteSegredo: true,
            certificadoPfxHexadecimal: "aabbccddeeff",
          },
        },
      },
    },
  });
  const json = JSON.stringify(publico);

  assert.equal(json.includes("aabbccddeeff"), false);
  assert.equal(publico.flags.efibank?.["2"]?.certificadoPfxHexadecimal, true);
  assert.equal(typeof publico.flags.efibank?.["2"]?.certificadoPfxHexadecimal, "boolean");
});

test("12. troca de provedor atualiza a UI sem reload completo", () => {
  const efi = formularioCredenciaisProvedor("efibank");
  const sicredi = formularioCredenciaisProvedor("sicredi");
  const inter = formularioCredenciaisProvedor("inter");

  assert.notDeepEqual(
    efi.campos.map((campo) => campo.chave),
    sicredi.campos.map((campo) => campo.chave)
  );
  assert.equal(efi.titulo, "Credenciais Efí Bank");
  assert.equal(sicredi.titulo, "Credenciais Sicredi");
  assert.equal(inter.titulo, "Credenciais Banco Inter");
});

test("13. provedor não mapeado não inventa campos", () => {
  const form = formularioCredenciaisProvedor("appless");
  assert.equal(form.configuracaoDisponivel, false);
  assert.deepEqual(form.campos, []);
  assert.ok(form.mensagemIndisponivel.length > 0);
});

test("14. validação identifica credencial obrigatória ausente", () => {
  const erros = validarCredenciaisDoProvedor("sicredi", {
    clienteId: "cli",
  });

  assert.ok(erros.some((erro) => erro.includes("Sicredi")));
  assert.ok(erros.some((erro) => erro.includes("Client Secret")));
  assert.ok(erros.some((erro) => erro.includes("certificado não configurado")));
  assert.equal(erros.some((erro) => erro.includes("cli")), false);
});

test("15. logs continuam sanitizados", () => {
  const sanitizado = JSON.stringify(
    sanitizarRespostaPix({
      clienteId: "id-secreto",
      clienteSegredo: "segredo-super-secreto",
      certificadoPemHexadecimal: "aabbcc",
      chavePrivadaPemHexadecimal: "ddeeff",
      tokenAcesso: "token-mp",
    })
  );
  const payload = JSON.stringify(
    payloadSemCredenciais({
      provedor: "sicredi",
      credenciais: {
        clienteSegredo: "segredo-super-secreto",
      },
    })
  );

  assert.equal(sanitizado.includes("segredo-super-secreto"), false);
  assert.equal(sanitizado.includes("id-secreto"), false);
  assert.equal(sanitizado.includes("token-mp"), false);
  assert.equal(payload.includes("segredo-super-secreto"), false);
  assert.match(payload, /\[oculto\]/);
});

test("flags de um provedor não vazam para outro", () => {
  const flags = flagsCredenciaisParaCliente({
    credenciais: {
      efibank: { "2": { clienteSegredo: true } },
      sicredi: { "2": { clienteSegredo: true } },
    },
  });

  assert.equal(flags.efibank?.["2"]?.clienteSegredo, true);
  assert.equal(flags.sicredi?.["2"]?.clienteSegredo, true);
  assert.equal(flags.inter?.["2"]?.clienteSegredo, undefined);
});

test("formulario vazio não coleta segredo para apagar", async () => {
  const form = new FormData();
  form.set("clienteId", "");
  form.set("clienteSegredo", "   ");
  const coletado = await coletarNovosSegredosDoFormulario(form, "sicredi");
  assert.deepEqual(coletado.novos, {});
  assert.equal(coletado.erro, undefined);
});

test("legado Efí não é aplicado a outro provedor", () => {
  const mesclado = mesclarSegredosProvedor({
    provedor: "sicredi",
    ambiente: "2",
    novos: {},
    existentes: {},
    legado: {
      cliente_id: "id-efi",
      cliente_segredo: "secret-efi",
      certificado_pfx: "aabbcc",
    },
  });

  assert.deepEqual(mesclado, {});
});

test("TODOS_OS_PROVEDORES_DO_SELECT_DEVEM_ESTAR_MAPEADOS", () => {
  for (const item of PROVEDORES_PIX_SELECIONAVEIS) {
    assert.equal(item.configuracaoDisponivel, true, item.codigo);
    assert.ok(item.nome, item.codigo);
    assert.ok(item.campos.length > 0, item.codigo);
  }

  const selecionaveis = PROVEDORES_PIX_GERANET.filter(
    (item) => item.configuracaoDisponivel
  );
  assert.deepEqual(
    selecionaveis.map((item) => item.codigo).sort(),
    PROVEDORES_PIX_SELECIONAVEIS.map((item) => item.codigo).sort()
  );
});

for (const provedor of PROVEDORES_PIX_SELECIONAVEIS) {
  test(`provedor selecionável ${provedor.codigo} possui registry completo`, () => {
    const form = formularioCredenciaisProvedor(provedor.codigo);
    assert.equal(form.configuracaoDisponivel, true);
    assert.ok(form.titulo.includes(provedor.nome));
    assert.ok(form.campos.length > 0);
    assert.ok(provedor.autenticacao);
    assert.ok(provedor.documentacaoGeranet);
  });

  test(`provedor ${provedor.codigo} não mistura secrets de outro PSP`, () => {
    const credenciais = filtrarCredenciaisDoProvedor(
      provedor.codigo,
      {
        ...misturado,
        chaveAplicacaoDesenvolvedor: "app-bb",
        chaveConsumidor: "cons-santander",
        segredoConsumidor: "seg-santander",
        tokenPagamento: "tok-pag",
        autenticacaoApi: "user-g2a",
        chaveAutenticacao: "key-g2a",
        tokenHomologacao: "tok-sicoob",
      },
      "chave-publica",
      "2"
    );
    const permitidas = new Set([
      ...formularioCredenciaisProvedor(provedor.codigo, "2").campos.map(
        (campo) => campo.chave
      ),
      ...(provedor.usaChavePix ? ["chavePix"] : []),
    ]);

    for (const chave of Object.keys(credenciais)) {
      assert.ok(permitidas.has(chave), `${provedor.codigo} vazou ${chave}`);
    }
  });

  test(`provedor ${provedor.codigo} valida obrigatórios sem expor segredo`, () => {
    const erros = validarCredenciaisDoProvedor(provedor.codigo, {}, "1");
    assert.ok(erros.length > 0);
    assert.equal(erros.some((erro) => erro.includes("secret-efi")), false);
    assert.equal(erros.some((erro) => erro.includes("aabbcc")), false);
  });

  test(`provedor ${provedor.codigo} isola homologação e produção`, () => {
    const empresaId = "emp-param";
    const vault = {
      [nomeSegredoBancario({
        empresaId,
        provedor: provedor.codigo,
        ambiente: "1",
        campo: "clienteId",
      })]: "id-prod",
      [nomeSegredoBancario({
        empresaId,
        provedor: provedor.codigo,
        ambiente: "2",
        campo: "clienteId",
      })]: "id-homolog",
    };

    const homolog = filtrarSegredosPorNamespace(
      vault,
      prefixoSegredosProvedor({
        empresaId,
        provedor: provedor.codigo,
        ambiente: "2",
      })
    );
    const producao = filtrarSegredosPorNamespace(
      vault,
      prefixoSegredosProvedor({
        empresaId,
        provedor: provedor.codigo,
        ambiente: "1",
      })
    );

    assert.equal(homolog.clienteId, "id-homolog");
    assert.equal(producao.clienteId, "id-prod");
  });

  test(`provedor ${provedor.codigo} não devolve certificado ao client`, () => {
    const publico = integracaoPublicaParaCliente({
      provedor: provedor.codigo,
      ambiente: "1",
      chave_pix: "chave",
      recebedor_nome: "Empresa",
      recebedor_cep: "78000000",
      recebedor_cidade: "Cuiabá",
      recebedor_uf: "MT",
      credenciais_configuradas: true,
      certificado_configurado: true,
      configuracao_publica: {
        credenciais: {
          [provedor.codigo]: {
            "1": {
              clienteSegredo: "nao-pode-vazar",
              certificadoPemHexadecimal: "aabbccddeeff",
              certificadoPfxHexadecimal: "112233445566",
              tokenAcesso: "token-completo",
            },
          },
        },
      },
    });
    const json = JSON.stringify(publico);
    assert.equal(json.includes("nao-pode-vazar"), false);
    assert.equal(json.includes("aabbccddeeff"), false);
    assert.equal(json.includes("token-completo"), false);
  });

  test(`provedor ${provedor.codigo} declara ambientes oficiais`, () => {
    const ambientes = ambientesSuportadosDoProvedor(provedor.codigo);
    assert.ok(ambientes.length > 0);
    if (!provedor.suportaHomologacao) {
      assert.equal(ambientes.includes("2"), false);
    }
    if (!provedor.suportaProducao) {
      assert.equal(ambientes.includes("1"), false);
    }
  });
}

test("troca de provedor atualiza campos sem reload", () => {
  const titulos = PROVEDORES_PIX_SELECIONAVEIS.map(
    (item) => formularioCredenciaisProvedor(item.codigo).titulo
  );
  assert.ok(new Set(titulos).size > 1);
});

test("Cielo homologação não exige certificado", () => {
  const homolog = formularioCredenciaisProvedor("cielo", "2");
  const producao = formularioCredenciaisProvedor("cielo", "1");
  assert.equal(
    homolog.campos.some((campo) => campo.chave === "certificadoPemHexadecimal"),
    false
  );
  assert.equal(
    producao.campos.some((campo) => campo.chave === "certificadoPemHexadecimal"),
    true
  );
});

test("Gerencianet e Efí compartilham o mesmo perfil de credenciais", () => {
  const efi = formularioCredenciaisProvedor("efibank");
  const gn = formularioCredenciaisProvedor("gerencianet");
  assert.deepEqual(
    efi.campos.map((campo) => campo.chave),
    gn.campos.map((campo) => campo.chave)
  );
  assert.equal(provedoresPixGeranet.gerencianet.codigo, "gerencianet");
  assert.equal(provedoresPixGeranet.efibank.codigo, "efibank");
});

test("Mercado Pago valida Access Token sem exigir Chave PIX", () => {
  const erros = validarCredenciaisDoProvedor("mercadopago", {}, "1");
  assert.ok(erros.some((erro) => erro.includes("Access Token")));
  assert.equal(erros.some((erro) => erro.includes("Chave PIX")), false);
});
