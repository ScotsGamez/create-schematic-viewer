import { gunzipSync, inflateSync } from "node:zlib";

const TAG = {
  END: 0,
  BYTE: 1,
  SHORT: 2,
  INT: 3,
  LONG: 4,
  FLOAT: 5,
  DOUBLE: 6,
  BYTE_ARRAY: 7,
  STRING: 8,
  LIST: 9,
  COMPOUND: 10,
  INT_ARRAY: 11,
  LONG_ARRAY: 12
};

export function parseNbt(input) {
  const buffer = decompressIfNeeded(input);
  const reader = new NbtReader(buffer);
  const type = reader.u8();

  if (type !== TAG.COMPOUND) {
    throw new Error(`Expected a root compound tag, found tag ${type}.`);
  }

  const name = reader.string();
  const value = reader.payload(TAG.COMPOUND);
  return { name, value };
}

function decompressIfNeeded(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return gunzipSync(buffer);
  }

  try {
    return inflateSync(buffer);
  } catch {
    return buffer;
  }
}

class NbtReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  u8() {
    this.ensure(1);
    return this.buffer[this.offset++];
  }

  i8() {
    this.ensure(1);
    return this.buffer.readInt8(this.offset++);
  }

  i16() {
    this.ensure(2);
    const value = this.buffer.readInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  i32() {
    this.ensure(4);
    const value = this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  i64() {
    this.ensure(8);
    const value = this.buffer.readBigInt64BE(this.offset);
    this.offset += 8;
    const numberValue = Number(value);
    return Number.isSafeInteger(numberValue) ? numberValue : value.toString();
  }

  f32() {
    this.ensure(4);
    const value = this.buffer.readFloatBE(this.offset);
    this.offset += 4;
    return value;
  }

  f64() {
    this.ensure(8);
    const value = this.buffer.readDoubleBE(this.offset);
    this.offset += 8;
    return value;
  }

  string() {
    const length = this.i16();
    this.ensure(length);
    const value = this.buffer.toString("utf8", this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  payload(type) {
    switch (type) {
      case TAG.END:
        return null;
      case TAG.BYTE:
        return this.i8();
      case TAG.SHORT:
        return this.i16();
      case TAG.INT:
        return this.i32();
      case TAG.LONG:
        return this.i64();
      case TAG.FLOAT:
        return this.f32();
      case TAG.DOUBLE:
        return this.f64();
      case TAG.BYTE_ARRAY:
        return this.array(this.i32(), () => this.i8());
      case TAG.STRING:
        return this.string();
      case TAG.LIST:
        return this.list();
      case TAG.COMPOUND:
        return this.compound();
      case TAG.INT_ARRAY:
        return this.array(this.i32(), () => this.i32());
      case TAG.LONG_ARRAY:
        return this.array(this.i32(), () => this.i64());
      default:
        throw new Error(`Unsupported NBT tag type ${type} at offset ${this.offset}.`);
    }
  }

  list() {
    const itemType = this.u8();
    const length = this.i32();
    return this.array(length, () => this.payload(itemType));
  }

  compound() {
    const value = {};

    while (true) {
      const type = this.u8();
      if (type === TAG.END) {
        return value;
      }

      const name = this.string();
      value[name] = this.payload(type);
    }
  }

  array(length, readItem) {
    if (length < 0) {
      throw new Error(`Invalid negative array length ${length}.`);
    }

    const values = new Array(length);
    for (let index = 0; index < length; index += 1) {
      values[index] = readItem();
    }
    return values;
  }

  ensure(length) {
    if (this.offset + length > this.buffer.length) {
      throw new Error("Unexpected end of NBT data.");
    }
  }
}
