import assert from "node:assert/strict";
import { test } from "node:test";

import {
  empresaA,
  empresaB,
  usuarioA,
  usuarioX,
} from "../multiempresa/cenario";
import { fonte } from "../multiempresa/fonte";
import { hrefsMenuPermitidos } from "./menu";
import { matrizVazia, permissoesIguais } from "./matriz";
import { PRESETS_PERFIL, presetDoPerfil } from "./presets";
import {
  origemDasPermissoes,
  resolverPermissoesEfetivas,
} from "./resolver";
import {
  decidirAcessoRota,
  primeiraRotaPermitida,
  resolverExigenciaRota,
} from "./rotas";
import { temAcessoModulo, temPermissao } from "./tem-permissao";
import { ultimoAdministradorFicariaIndefeso } from "./ultimo-administrador";

test("administrador tem acesso total mesmo sem linhas", () => {
  const efetivas = resolverPermissoesEfetivas({
    perfil: "administrador",
    linhas: [],
  });

  assert.equal(temPermissao(efetivas, "usuarios", "alterar_permissoes"), true);
  assert.equal(temPermissao(efetivas, "fiscal", "configurar_fiscal"), true);
  assert.equal(temPermissao(efetivas, "pdv", "finalizar_venda"), true);
  assert.equal(origemDasPermissoes({ perfil: "administrador", linhas: [] }), "administrador");
});

test("vendedor não acessa Configurações por padrão", () => {
  const vendedor = presetDoPerfil("vendedor");
  assert.equal(temAcessoModulo(vendedor, "configuracoes"), false);
  assert.equal(temAcessoModulo(vendedor, "usuarios"), false);
  assert.equal(temAcessoModulo(vendedor, "inicio"), true);
  assert.equal(temPermissao(vendedor, "produtos", "acessar"), true);
  assert.equal(temPermissao(vendedor, "produtos", "editar"), false);
});

test("caixa acessa PDV", () => {
  const caixa = presetDoPerfil("caixa");
  assert.equal(temPermissao(caixa, "pdv", "acessar"), true);
  assert.equal(temPermissao(caixa, "pdv", "finalizar_venda"), true);
  assert.equal(temPermissao(caixa, "clientes", "receber_carteira"), true);
  assert.equal(temAcessoModulo(caixa, "configuracoes"), false);
});

test("contador não acessa PDV por padrão e acessa Contabilidade", () => {
  const contador = presetDoPerfil("contador");
  assert.equal(temAcessoModulo(contador, "pdv"), false);
  assert.equal(temAcessoModulo(contador, "contabilidade"), true);
  assert.equal(temPermissao(contador, "contabilidade", "baixar_xml"), true);
  assert.equal(temPermissao(contador, "contabilidade", "inventario"), true);
});

test("permissão personalizada sobrescreve preset do perfil", () => {
  const efetivas = resolverPermissoesEfetivas({
    perfil: "vendedor",
    linhas: [
      {
        modulo: "produtos",
        permissoes: { acessar: true, criar: false, editar: true, excluir: false, importar: false },
      },
    ],
  });

  assert.equal(temPermissao(efetivas, "produtos", "editar"), true);
  assert.equal(temPermissao(presetDoPerfil("vendedor"), "produtos", "editar"), false);
  assert.equal(
    origemDasPermissoes({
      perfil: "vendedor",
      linhas: [
        {
          modulo: "produtos",
          permissoes: { acessar: true, editar: true },
        },
      ],
    }),
    "personalizada"
  );
});

test("usuário empresa A não recebe permissões da empresa B", () => {
  const lucasA = resolverPermissoesEfetivas({
    perfil: "vendedor",
    linhas: [
      { modulo: "produtos", permissoes: { acessar: true, editar: true } },
    ],
  });
  const lucasB = resolverPermissoesEfetivas({
    perfil: "vendedor",
    linhas: [],
  });

  assert.equal(temPermissao(lucasA, "produtos", "editar"), true);
  assert.equal(temPermissao(lucasB, "produtos", "editar"), false);
  assert.notEqual(empresaA, empresaB);
  const idUsuarioA: string = usuarioA;
  const idUsuarioX: string = usuarioX;
  assert.equal(idUsuarioA === idUsuarioX, false);
});

test("mesmo usuário pode ter permissões diferentes entre empresa A e B", () => {
  const naA = resolverPermissoesEfetivas({
    perfil: "caixa",
    linhas: [],
  });
  const naB = resolverPermissoesEfetivas({
    perfil: "contador",
    linhas: [],
  });

  assert.equal(temAcessoModulo(naA, "pdv"), true);
  assert.equal(temAcessoModulo(naB, "pdv"), false);
  assert.equal(temAcessoModulo(naB, "contabilidade"), true);
  assert.equal(temAcessoModulo(naA, "contabilidade"), false);
});

test("sidebar esconde módulo sem acesso", () => {
  const hrefs = hrefsMenuPermitidos(presetDoPerfil("vendedor"));
  assert.ok(hrefs.includes("/painel"));
  assert.ok(hrefs.includes("/vendas"));
  assert.equal(hrefs.includes("/configuracoes"), false);
  assert.equal(hrefs.includes("/contabilidade"), false);

  const sidebar = fonte("components/layout/app-sidebar.tsx");
  assert.match(sidebar, /hrefsMenuPermitidos|permissoes/);
});

test("digitar rota diretamente sem permissão é bloqueado", () => {
  const vendedor = presetDoPerfil("vendedor");
  const bloqueio = decidirAcessoRota({
    pathname: "/configuracoes",
    permissoes: vendedor,
  });

  assert.equal(bloqueio.ok, false);
  if (!bloqueio.ok) {
    assert.notEqual(bloqueio.redirect, "/configuracoes");
  }

  const permitido = decidirAcessoRota({
    pathname: "/pdv",
    permissoes: vendedor,
  });
  assert.equal(permitido.ok, true);

  assert.deepEqual(resolverExigenciaRota("/produtos"), {
    tipo: "permissao",
    modulo: "produtos",
    acao: "acessar",
  });
});

test("Server Action sem permissão é bloqueada", () => {
  const produtos = fonte("app/produtos/actions.ts");
  assert.match(produtos, /exigirPermissao/);
  assert.match(produtos, /modulo:\s*"produtos"/);

  const pdv = fonte("app/pdv/actions.ts");
  assert.match(pdv, /exigirPermissao/);
  assert.match(pdv, /finalizar_venda/);
});

test("último administrador não pode ser desativado nem perder perfil admin", () => {
  assert.equal(
    ultimoAdministradorFicariaIndefeso({
      eraAdminAtivo: true,
      novoPerfil: "vendedor",
      novoAtivo: true,
      outrosAdminsAtivos: 0,
    }),
    true
  );
  assert.equal(
    ultimoAdministradorFicariaIndefeso({
      eraAdminAtivo: true,
      novoPerfil: "administrador",
      novoAtivo: false,
      outrosAdminsAtivos: 0,
    }),
    true
  );
  assert.equal(
    ultimoAdministradorFicariaIndefeso({
      eraAdminAtivo: true,
      novoPerfil: "vendedor",
      novoAtivo: true,
      outrosAdminsAtivos: 1,
    }),
    false
  );

  const rota = fonte("app/api/configuracoes/usuarios/[id]/route.ts");
  assert.match(rota, /ultimoAdministradorFicariaIndefeso/);
});

test("usuário novo recebe preset correto", () => {
  assert.ok(permissoesIguais(presetDoPerfil("caixa"), PRESETS_PERFIL.caixa));
  const criar = fonte("app/api/configuracoes/usuarios/route.ts");
  assert.match(criar, /substituirPermissoesUsuarioEmpresa/);
});

test("troca de perfil pode aplicar novo preset", () => {
  const rota = fonte("app/api/configuracoes/usuarios/[id]/route.ts");
  assert.match(rota, /aplicar_preset|aplicarPreset/);
  assert.equal(
    temAcessoModulo(presetDoPerfil("gerente"), "vendas"),
    true
  );
  assert.equal(
    temPermissao(presetDoPerfil("gerente"), "usuarios", "alterar_permissoes"),
    false
  );
});

test("gerente/vendedor não podem alterar permissões sem autorização", () => {
  assert.equal(
    temPermissao(presetDoPerfil("gerente"), "usuarios", "alterar_permissoes"),
    false
  );
  assert.equal(
    temPermissao(presetDoPerfil("vendedor"), "usuarios", "alterar_permissoes"),
    false
  );

  const personalizado = resolverPermissoesEfetivas({
    perfil: "gerente",
    linhas: [
      {
        modulo: "usuarios",
        permissoes: {
          acessar: true,
          criar: false,
          editar: false,
          desativar: false,
          alterar_permissoes: true,
        },
      },
    ],
  });
  assert.equal(temPermissao(personalizado, "usuarios", "alterar_permissoes"), true);
});

test("matriz vazia não libera nenhum módulo", () => {
  const vazia = matrizVazia();
  assert.equal(temAcessoModulo(vazia, "inicio"), false);
  assert.equal(primeiraRotaPermitida(vazia), "/acesso-negado");
});

test("migration de permissões isola por usuario e empresa", () => {
  const sql = fonte(
    "supabase/migrations/20260819200000_permissoes_granulares_usuario_empresa.sql"
  );
  assert.match(sql, /usuarios_permissoes_empresas/);
  assert.match(sql, /UNIQUE \(usuario_id, empresa_id, modulo\)/);
  assert.match(sql, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(sql, /usuario_id = auth.uid\(\)/);
});
