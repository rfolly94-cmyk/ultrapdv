#include <stddef.h>
#include <stdio.h>
#include "PGWebLib.h"

static void campo(const char *estrutura, const char *nome, size_t offset, size_t tamanho)
{
    printf("offset %s %s %zu %zu\n", estrutura, nome, offset, tamanho);
}

int main(void)
{
    printf("comprovado_contra_dll 0\n");
    printf("sizeof Byte %zu\n", sizeof(Byte));
    printf("sizeof Word %zu\n", sizeof(Word));
    printf("sizeof Uint32 %zu\n", sizeof(Uint32));
    printf("sizeof Int16 %zu\n", sizeof(Int16));
    printf("sizeof Uint16 %zu\n", sizeof(Uint16));
    printf("sizeof Bool %zu\n", sizeof(Bool));
    printf("sizeof char %zu\n", sizeof(char));
    printf("alignof PW_GetData %zu\n", _Alignof(PW_GetData));
    printf("sizeof PW_GetData %zu\n", sizeof(PW_GetData));
    printf("alignof PW_Operations %zu\n", _Alignof(PW_Operations));
    printf("sizeof PW_Operations %zu\n", sizeof(PW_Operations));
    printf("alignof PW_OperationsEx %zu\n", _Alignof(PW_OperationsEx));
    printf("sizeof PW_OperationsEx %zu\n", sizeof(PW_OperationsEx));

    campo("PW_GetData", "wIdentificador", offsetof(PW_GetData, wIdentificador), sizeof(((PW_GetData *)0)->wIdentificador));
    campo("PW_GetData", "bTipoDeDado", offsetof(PW_GetData, bTipoDeDado), sizeof(((PW_GetData *)0)->bTipoDeDado));
    campo("PW_GetData", "szPrompt", offsetof(PW_GetData, szPrompt), sizeof(((PW_GetData *)0)->szPrompt));
    campo("PW_GetData", "bNumOpcoesMenu", offsetof(PW_GetData, bNumOpcoesMenu), sizeof(((PW_GetData *)0)->bNumOpcoesMenu));
    campo("PW_GetData", "vszTextoMenu", offsetof(PW_GetData, vszTextoMenu), sizeof(((PW_GetData *)0)->vszTextoMenu));
    campo("PW_GetData", "vszValorMenu", offsetof(PW_GetData, vszValorMenu), sizeof(((PW_GetData *)0)->vszValorMenu));
    campo("PW_GetData", "szMascaraDeCaptura", offsetof(PW_GetData, szMascaraDeCaptura), sizeof(((PW_GetData *)0)->szMascaraDeCaptura));
    campo("PW_GetData", "bTiposEntradaPermitidos", offsetof(PW_GetData, bTiposEntradaPermitidos), sizeof(((PW_GetData *)0)->bTiposEntradaPermitidos));
    campo("PW_GetData", "bTamanhoMinimo", offsetof(PW_GetData, bTamanhoMinimo), sizeof(((PW_GetData *)0)->bTamanhoMinimo));
    campo("PW_GetData", "bTamanhoMaximo", offsetof(PW_GetData, bTamanhoMaximo), sizeof(((PW_GetData *)0)->bTamanhoMaximo));
    campo("PW_GetData", "ulValorMinimo", offsetof(PW_GetData, ulValorMinimo), sizeof(((PW_GetData *)0)->ulValorMinimo));
    campo("PW_GetData", "ulValorMaximo", offsetof(PW_GetData, ulValorMaximo), sizeof(((PW_GetData *)0)->ulValorMaximo));
    campo("PW_GetData", "bOcultarDadosDigitados", offsetof(PW_GetData, bOcultarDadosDigitados), sizeof(((PW_GetData *)0)->bOcultarDadosDigitados));
    campo("PW_GetData", "bValidacaoDado", offsetof(PW_GetData, bValidacaoDado), sizeof(((PW_GetData *)0)->bValidacaoDado));
    campo("PW_GetData", "bAceitaNulo", offsetof(PW_GetData, bAceitaNulo), sizeof(((PW_GetData *)0)->bAceitaNulo));
    campo("PW_GetData", "szValorInicial", offsetof(PW_GetData, szValorInicial), sizeof(((PW_GetData *)0)->szValorInicial));
    campo("PW_GetData", "bTeclasDeAtalho", offsetof(PW_GetData, bTeclasDeAtalho), sizeof(((PW_GetData *)0)->bTeclasDeAtalho));
    campo("PW_GetData", "szMsgValidacao", offsetof(PW_GetData, szMsgValidacao), sizeof(((PW_GetData *)0)->szMsgValidacao));
    campo("PW_GetData", "szMsgConfirmacao", offsetof(PW_GetData, szMsgConfirmacao), sizeof(((PW_GetData *)0)->szMsgConfirmacao));
    campo("PW_GetData", "szMsgDadoMaior", offsetof(PW_GetData, szMsgDadoMaior), sizeof(((PW_GetData *)0)->szMsgDadoMaior));
    campo("PW_GetData", "szMsgDadoMenor", offsetof(PW_GetData, szMsgDadoMenor), sizeof(((PW_GetData *)0)->szMsgDadoMenor));
    campo("PW_GetData", "bCapturarDataVencCartao", offsetof(PW_GetData, bCapturarDataVencCartao), sizeof(((PW_GetData *)0)->bCapturarDataVencCartao));
    campo("PW_GetData", "ulTipoEntradaCartao", offsetof(PW_GetData, ulTipoEntradaCartao), sizeof(((PW_GetData *)0)->ulTipoEntradaCartao));
    campo("PW_GetData", "bItemInicial", offsetof(PW_GetData, bItemInicial), sizeof(((PW_GetData *)0)->bItemInicial));
    campo("PW_GetData", "bNumeroCapturas", offsetof(PW_GetData, bNumeroCapturas), sizeof(((PW_GetData *)0)->bNumeroCapturas));
    campo("PW_GetData", "szMsgPrevia", offsetof(PW_GetData, szMsgPrevia), sizeof(((PW_GetData *)0)->szMsgPrevia));
    campo("PW_GetData", "bTipoEntradaCodigoBarras", offsetof(PW_GetData, bTipoEntradaCodigoBarras), sizeof(((PW_GetData *)0)->bTipoEntradaCodigoBarras));
    campo("PW_GetData", "bOmiteMsgAlerta", offsetof(PW_GetData, bOmiteMsgAlerta), sizeof(((PW_GetData *)0)->bOmiteMsgAlerta));
    campo("PW_GetData", "bIniciaPelaEsquerda", offsetof(PW_GetData, bIniciaPelaEsquerda), sizeof(((PW_GetData *)0)->bIniciaPelaEsquerda));
    campo("PW_GetData", "bNotificarCancelamento", offsetof(PW_GetData, bNotificarCancelamento), sizeof(((PW_GetData *)0)->bNotificarCancelamento));
    campo("PW_GetData", "bAlinhaPelaDireita", offsetof(PW_GetData, bAlinhaPelaDireita), sizeof(((PW_GetData *)0)->bAlinhaPelaDireita));

    campo("PW_Operations", "bOperType", offsetof(PW_Operations, bOperType), sizeof(((PW_Operations *)0)->bOperType));
    campo("PW_Operations", "szText", offsetof(PW_Operations, szText), sizeof(((PW_Operations *)0)->szText));
    campo("PW_Operations", "szValue", offsetof(PW_Operations, szValue), sizeof(((PW_Operations *)0)->szValue));

    campo("PW_OperationsEx", "bOperType", offsetof(PW_OperationsEx, bOperType), sizeof(((PW_OperationsEx *)0)->bOperType));
    campo("PW_OperationsEx", "szOperName", offsetof(PW_OperationsEx, szOperName), sizeof(((PW_OperationsEx *)0)->szOperName));
    campo("PW_OperationsEx", "szAuthSyst", offsetof(PW_OperationsEx, szAuthSyst), sizeof(((PW_OperationsEx *)0)->szAuthSyst));
    campo("PW_OperationsEx", "szValue", offsetof(PW_OperationsEx, szValue), sizeof(((PW_OperationsEx *)0)->szValue));
    campo("PW_OperationsEx", "fAuthPreferential", offsetof(PW_OperationsEx, fAuthPreferential), sizeof(((PW_OperationsEx *)0)->fAuthPreferential));
    campo("PW_OperationsEx", "bPaymentMode", offsetof(PW_OperationsEx, bPaymentMode), sizeof(((PW_OperationsEx *)0)->bPaymentMode));

    printf("enum PWRET_OK %d\n", PWRET_OK);
    printf("enum PWRET_FROMHOSTPENDTRN %d\n", PWRET_FROMHOSTPENDTRN);
    printf("enum PWRET_FROMHOST %d\n", PWRET_FROMHOST);
    printf("enum PWRET_INVPARAM %d\n", PWRET_INVPARAM);
    printf("enum PWRET_NOTINST %d\n", PWRET_NOTINST);
    printf("enum PWRET_MOREDATA %d\n", PWRET_MOREDATA);
    printf("enum PWRET_NODATA %d\n", PWRET_NODATA);
    printf("enum PWRET_DISPLAY %d\n", PWRET_DISPLAY);
    printf("enum PWRET_INVCALL %d\n", PWRET_INVCALL);
    printf("enum PWRET_NOTHING %d\n", PWRET_NOTHING);
    printf("enum PWRET_BUFOVFLW %d\n", PWRET_BUFOVFLW);
    printf("enum PWRET_CANCEL %d\n", PWRET_CANCEL);
    printf("enum PWRET_TIMEOUT %d\n", PWRET_TIMEOUT);
    printf("enum PWRET_PPNOTFOUND %d\n", PWRET_PPNOTFOUND);
    printf("enum PWRET_TRNNOTINIT %d\n", PWRET_TRNNOTINIT);
    printf("enum PWRET_DLLNOTINIT %d\n", PWRET_DLLNOTINIT);
    printf("enum PWRET_FALLBACK %d\n", PWRET_FALLBACK);
    printf("enum PWRET_WRITERR %d\n", PWRET_WRITERR);
    printf("enum PWRET_PPCOMERR %d\n", PWRET_PPCOMERR);
    printf("enum ENVRMNT_PROD %d\n", ENVRMNT_PROD);
    printf("enum ENVRMNT_TEST %d\n", ENVRMNT_TEST);
    printf("define PWMENU_MAXINTENS %d\n", PWMENU_MAXINTENS);
    printf("define PWOPER_INSTALL %d\n", PWOPER_INSTALL);
    printf("define PWOPER_ADMIN %d\n", PWOPER_ADMIN);
    printf("define PWOPER_SALE %d\n", PWOPER_SALE);
    printf("define PWOPER_SALEVOID %d\n", PWOPER_SALEVOID);
    printf("define PWINFO_TOTAMNT %d\n", PWINFO_TOTAMNT);
    printf("define PWINFO_CURRENCY %d\n", PWINFO_CURRENCY);
    printf("define PWINFO_CARDTYPE %d\n", PWINFO_CARDTYPE);
    printf("define PWINFO_REQNUM %d\n", PWINFO_REQNUM);
    printf("define PWINFO_CNFREQ %d\n", PWINFO_CNFREQ);
    printf("define PWINFO_AUTHTECHUSER %d\n", PWINFO_AUTHTECHUSER);
    printf("define PWDAT_USERAUTH %d\n", PWDAT_USERAUTH);
    return 0;
}
