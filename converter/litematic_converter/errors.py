class ConverterError(Exception):
    """Base exception for user-facing conversion errors."""


class MalformedLitematicError(ConverterError):
    """Raised when an input file does not match the expected Litematica shape."""


class UnsupportedConversionError(ConverterError):
    """Raised when a requested conversion cannot be represented safely."""
