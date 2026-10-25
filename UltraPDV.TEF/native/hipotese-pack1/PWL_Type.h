#ifndef ULTRAPDV_PWL_TYPE_HIPOTESE_PACK1
#define ULTRAPDV_PWL_TYPE_HIPOTESE_PACK1
/*
 * Este arquivo nao pertence ao SDK da SETIS.
 * Mesmas larguras da hipotese Windows, com empacotamento de 1 byte.
 * Serve apenas para mostrar que um #pragma pack ausente em PWL_Type.h
 * mudaria o tamanho de PW_GetData.
 */
typedef signed char Int8;
typedef unsigned char Byte;
typedef unsigned char Uint8;
typedef short Int16;
typedef unsigned short Word;
typedef unsigned short Uint16;
typedef int Int32;
typedef unsigned int Uint32;
typedef int Bool;
#pragma pack(push, 1)
#endif
