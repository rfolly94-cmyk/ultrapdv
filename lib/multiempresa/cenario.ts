export const usuarioA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const usuarioB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const usuarioX = "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx";
export const usuarioSemVinculo = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export const empresaA = "11111111-1111-4111-8111-111111111111";
export const empresaB = "22222222-2222-4222-8222-222222222222";

export const clienteA = "c1111111-1111-4111-8111-111111111111";
export const clienteB = "c2222222-2222-4222-8222-222222222222";

export const produtoA = "p1111111-1111-4111-8111-111111111111";
export const produtoB = "p2222222-2222-4222-8222-222222222222";

export const grupoFiscalA = "g1111111-1111-4111-8111-111111111111";
export const grupoFiscalB = "g2222222-2222-4222-8222-222222222222";

export const vendaA = "v1111111-1111-4111-8111-111111111111";
export const vendaB = "v2222222-2222-4222-8222-222222222222";

export const emissaoA = "e1111111-1111-4111-8111-111111111111";
export const emissaoB = "e2222222-2222-4222-8222-222222222222";

export const cobrancaA = "b1111111-1111-4111-8111-111111111111";
export const cobrancaB = "b2222222-2222-4222-8222-222222222222";

export const entradaA = "n1111111-1111-4111-8111-111111111111";
export const entradaB = "n2222222-2222-4222-8222-222222222222";

export type VinculoTeste = {
  usuario_id: string;
  empresa_id: string;
  principal: boolean;
  ativo: boolean;
  perfil: string;
};

export const vinculosPadrao: VinculoTeste[] = [
  {
    usuario_id: usuarioA,
    empresa_id: empresaA,
    principal: true,
    ativo: true,
    perfil: "administrador",
  },
  {
    usuario_id: usuarioB,
    empresa_id: empresaB,
    principal: true,
    ativo: true,
    perfil: "administrador",
  },
  {
    usuario_id: usuarioX,
    empresa_id: empresaA,
    principal: true,
    ativo: true,
    perfil: "contador",
  },
  {
    usuario_id: usuarioX,
    empresa_id: empresaB,
    principal: false,
    ativo: true,
    perfil: "contador",
  },
];

export type RegistroEmpresa = {
  id: string;
  empresa_id: string;
};
