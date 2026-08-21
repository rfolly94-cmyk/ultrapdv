export type EmpresaMasterPlanoOpcao = {
  id: string;
  nome: string;
  valorMensal: number | null;
  ativo: boolean;
};

export type EmpresaMasterUsuario = {
  id: string;
  nome: string;
  email: string;
  perfil: string;
  rotuloPerfil: string;
  principal: boolean;
  ativo: boolean;
};

export type EmpresaMasterHistorico = {
  id: string;
  tipo: string;
  dados: Record<string, unknown>;
  detalhe: string;
  administrador: string;
  createdAt: string;
};

export type EmpresaMasterUso = {
  usuarios: number;
  produtos: number | null;
  clientes: number | null;
  vendasMes: number | null;
  nfceMes: number | null;
  nfeMes: number | null;
  limiteUsuarios: number | null;
  limiteFiliais: number | null;
};

export type EmpresaMasterAssinatura = {
  id: string;
  empresa_id: string;
  plano_id: string | null;
  status: string;
  inicio_em: string | null;
  vencimento_em: string | null;
  carencia_ate: string | null;
  liberado_ate: string | null;
  suspenso_em: string | null;
  cancelado_em: string | null;
  observacao: string | null;
  plano_nome: string | null;
  plano_valor_mensal: number | null;
  valor_mensal_contratado: number | null;
  dias_teste: number | null;
};

export type EmpresaMasterDetalheDados = {
  masterUsuarioId: string;
  empresa: {
    id: string;
    nomeFantasia: string;
    razaoSocial: string;
    cnpj: string;
    cadastro: string;
  };
  assinatura: EmpresaMasterAssinatura | null;
  planos: EmpresaMasterPlanoOpcao[];
  uso: EmpresaMasterUso;
  usuarios: EmpresaMasterUsuario[];
  historico: EmpresaMasterHistorico[];
};
