"use client";

import { useState, type ReactNode } from "react";

import { EnderecoViaCepCampos } from "@/components/cadastro/endereco-via-cep-campos";
import { ConsultaCnpjCampo } from "@/components/cadastro/consulta-cnpj-campo";
import {
  mascararCnpjDigitando,
  preencherCadastroComCnpj,
  type DadosCnpjNormalizados,
} from "@/lib/cadastro/cnpj";
import { mascararCpfDigitando } from "@/lib/fiscal/destinatario/documento";

const inputClass = "updv-input mt-1 w-full";

function formatarDocumentoDigitando(valor: string) {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  if (digitos.length <= 11) return mascararCpfDigitando(valor);
  return mascararCnpjDigitando(valor);
}

export type ClienteCamposCnpjInicial = {
  tipoPessoa?: string | null;
  nome?: string | null;
  nomeFantasia?: string | null;
  cpfCnpj?: string | null;
  inscricaoEstadual?: string | null;
  telefone?: string | null;
  email?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  codigoMunicipioIbge?: string | null;
  uf?: string | null;
};

function texto(valor?: string | null) {
  return String(valor ?? "");
}

export function ClienteCamposCnpj({
  modo,
  inicial,
  extraIdentificacao,
}: {
  modo: "novo" | "edicao";
  inicial?: ClienteCamposCnpjInicial;
  extraIdentificacao?: ReactNode;
}) {
  const [tipoPessoa, setTipoPessoa] = useState(inicial?.tipoPessoa === "J" ? "J" : "F");
  const [nome, setNome] = useState(texto(inicial?.nome));
  const [nomeFantasia, setNomeFantasia] = useState(texto(inicial?.nomeFantasia));
  const [cpfCnpj, setCpfCnpj] = useState(
    formatarDocumentoDigitando(texto(inicial?.cpfCnpj))
  );
  const [inscricaoEstadual, setInscricaoEstadual] = useState(
    texto(inicial?.inscricaoEstadual)
  );
  const [telefone, setTelefone] = useState(texto(inicial?.telefone));
  const [email, setEmail] = useState(texto(inicial?.email));
  const [endereco, setEndereco] = useState({
    cep: texto(inicial?.cep),
    logradouro: texto(inicial?.logradouro),
    numero: texto(inicial?.numero),
    complemento: texto(inicial?.complemento),
    bairro: texto(inicial?.bairro),
    municipio: texto(inicial?.municipio),
    codigoMunicipioIbge: texto(inicial?.codigoMunicipioIbge),
    uf: texto(inicial?.uf),
  });
  const [enderecoChave, setEnderecoChave] = useState(0);

  function aplicarCnpj(dados: DadosCnpjNormalizados) {
    const preenchido = preencherCadastroComCnpj(
      {
        nome,
        nomeFantasia,
        inscricaoEstadual,
        telefone,
        email,
        cep: endereco.cep,
        logradouro: endereco.logradouro,
        numero: endereco.numero,
        complemento: endereco.complemento,
        bairro: endereco.bairro,
        municipio: endereco.municipio,
        codigoMunicipioIbge: endereco.codigoMunicipioIbge,
        uf: endereco.uf,
      },
      {
        nome: dados.razaoSocial,
        nomeFantasia: dados.nomeFantasia,
        inscricaoEstadual: dados.inscricaoEstadual,
        telefone: dados.telefone,
        email: dados.email,
        cep: dados.cep,
        logradouro: dados.logradouro,
        numero: dados.numero,
        complemento: dados.complemento,
        bairro: dados.bairro,
        municipio: dados.cidade,
        codigoMunicipioIbge: dados.codigoIbge,
        uf: dados.uf,
      }
    );
    setTipoPessoa("J");
    setNome(preenchido.nome);
    setNomeFantasia(preenchido.nomeFantasia);
    setCpfCnpj(mascararCnpjDigitando(dados.cnpj));
    setInscricaoEstadual(preenchido.inscricaoEstadual);
    setTelefone(preenchido.telefone);
    setEmail(preenchido.email);
    setEndereco({
      cep: preenchido.cep,
      logradouro: preenchido.logradouro,
      numero: preenchido.numero,
      complemento: preenchido.complemento,
      bairro: preenchido.bairro,
      municipio: preenchido.municipio,
      codigoMunicipioIbge: preenchido.codigoMunicipioIbge,
      uf: preenchido.uf,
    });
    setEnderecoChave((atual) => atual + 1);
  }

  return (
    <>
      <div className="mt-4 grid gap-5 md:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="text-sm font-medium text-zinc-700" htmlFor="tipo_pessoa">
            Tipo de pessoa
          </label>
          <select
            id="tipo_pessoa"
            name="tipo_pessoa"
            value={tipoPessoa}
            onChange={(event) => {
              const tipo = event.target.value === "J" ? "J" : "F";
              setTipoPessoa(tipo);
              setCpfCnpj(formatarDocumentoDigitando(cpfCnpj));
            }}
            className={inputClass}
          >
            <option value="F">Pessoa Física</option>
            <option value="J">Pessoa Jurídica</option>
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-zinc-700" htmlFor="nome">
            Nome / Razão social *
          </label>
          <input
            id="nome"
            name="nome"
            required
            value={nome}
            onChange={(event) => setNome(event.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-zinc-700" htmlFor="nome_fantasia">
            Nome fantasia
          </label>
          <input
            id="nome_fantasia"
            name="nome_fantasia"
            value={nomeFantasia}
            onChange={(event) => setNomeFantasia(event.target.value)}
            className={inputClass}
          />
        </div>

        <ConsultaCnpjCampo
          name="cpf_cnpj"
          label="CPF / CNPJ"
          value={cpfCnpj}
          onChange={setCpfCnpj}
          onAplicar={aplicarCnpj}
          modo={modo}
          formatar={formatarDocumentoDigitando}
        />

        <div>
          <label className="text-sm font-medium text-zinc-700" htmlFor="inscricao_estadual">
            Inscrição Estadual
          </label>
          <input
            id="inscricao_estadual"
            name="inscricao_estadual"
            value={inscricaoEstadual}
            onChange={(event) => setInscricaoEstadual(event.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-zinc-700" htmlFor="telefone">
            Telefone
          </label>
          <input
            id="telefone"
            name="telefone"
            value={telefone}
            inputMode="tel"
            onChange={(event) => setTelefone(event.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-zinc-700" htmlFor="email">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </div>

        {extraIdentificacao}
      </div>

      <div className="my-7 border-t border-zinc-200" />

      <h3 className="font-semibold text-zinc-900">Endereço</h3>

      <EnderecoViaCepCampos key={enderecoChave} inicial={endereco} />
    </>
  );
}
