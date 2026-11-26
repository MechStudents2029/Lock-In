"""Model registry for Model A/B/C (+ mock). Real models come from the ML agent's
adapter module (see docs/API.md, "ML adapter contract"). Nothing is imported or
loaded until a model is selected, so idle GPU memory stays at zero."""
from __future__ import annotations

import importlib
import logging
import sys
from pathlib import Path
from typing import Callable

from ..config import BACKEND_ROOT, InferenceCfg
from ..schemas import ModelInfo
from .base import InferenceModel
from .mock import MockModel

log = logging.getLogger(__name__)

CATALOG = {
    "A": ("Model A", "YOLO + programmed classification rules"),
    "B": ("Model B", "YOLO + custom Random Forest"),
    "C": ("Model C", "YOLO + custom neural network"),
}


class ModelRegistry:
    def __init__(self, cfg: InferenceCfg, factories: dict[str, Callable[[str], InferenceModel]] | None = None):
        self.cfg = cfg
        self._factories = factories  # test injection: model_id -> factory(device)
        self._adapter = None
        self._adapter_err: str | None = None
        self._adapter_tried = False

    def _load_adapter(self):
        if self._adapter_tried:
            return self._adapter
        self._adapter_tried = True
        src = Path(self.cfg.ml_src_path)
        src = src if src.is_absolute() else (BACKEND_ROOT / src).resolve()
        if src.is_dir() and str(src) not in sys.path:
            sys.path.insert(0, str(src))
        try:
            self._adapter = importlib.import_module(self.cfg.ml_adapter_module)
        except Exception as e:  # noqa: BLE001  (ImportError or errors inside ML deps)
            self._adapter_err = f"ML adapter '{self.cfg.ml_adapter_module}' unavailable: {type(e).__name__}: {e}"
            log.info(self._adapter_err)
        return self._adapter

    def _adapter_supports(self, mid: str) -> tuple[bool, str | None]:
        ad = self._load_adapter()
        if ad is None:
            return False, self._adapter_err
        fn = getattr(ad, "available_models", None)
        if callable(fn):
            try:
                if mid not in set(fn()):
                    return False, f"adapter does not provide model {mid} yet"
            except Exception as e:  # noqa: BLE001
                return False, f"adapter.available_models failed: {e}"
        if not callable(getattr(ad, "create_model", None)):
            return False, "adapter lacks create_model()"
        return True, None

    def list(self, active: str | None) -> list[ModelInfo]:
        out = [ModelInfo(id="mock", name="Mock (simulated)", simulated=True, available=True,
                         description="Synthetic outputs for UI/hardware development. NOT a real model.",
                         loaded=active == "mock")]
        for mid, (name, desc) in CATALOG.items():
            if self._factories is not None:
                ok, why = (mid in self._factories), "no factory registered"
            else:
                ok, why = self._adapter_supports(mid)
            out.append(ModelInfo(id=mid, name=name, description=desc, simulated=False, available=ok,
                                 unavailable_reason=None if ok else why, loaded=active == mid))
        return out

    def create(self, mid: str, device: str) -> InferenceModel:
        if mid == "mock":
            return MockModel()
        if self._factories is not None:
            if mid not in self._factories:
                raise KeyError(f"model {mid} not available")
            return self._factories[mid](device)
        ok, why = self._adapter_supports(mid)
        if not ok:
            raise KeyError(why or f"model {mid} not available")
        return self._adapter.create_model(mid, device)
