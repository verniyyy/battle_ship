import json

from PIL import Image

from portraitgen import run


def _candidate(work, card, seed, ok, score):
    d = work / "candidates" / card
    d.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (run.WIDTH // 8, run.HEIGHT // 8)).save(d / f"{seed}.png")
    report = {"ok": ok, "issues": [] if ok else ["cut off at the bottom"], "notes": [], "aesthetic": 0.5, "score": score}
    (d / f"{seed}.json").write_text(json.dumps(report))


def test_best_ranks_accepted_candidates_and_takes_str_paths(tmp_path):
    # The notebook passes its work directory as a plain string.
    _candidate(tmp_path, "bb_guren", 1, True, 0.6)
    _candidate(tmp_path, "bb_guren", 2, True, 0.9)
    _candidate(tmp_path, "bb_guren", 3, False, 0.99)
    work = str(tmp_path)
    assert [seed for seed, _ in run.candidates(work, "bb_guren")] == [2, 1, 3]
    assert run.best(work, "bb_guren") == 2
    assert run.best(work, "nobody") is None
    assert run.candidate_sheet(work, "bb_guren") is not None


def test_job_load_reads_expectations(tmp_path):
    job = {k: "x" for k in ("id", "name", "prompt", "negative", "face_prompt", "hand_prompt", "tile_prompt", "detail_negative")}
    job |= {"seed": 1, "require": ["blue_hair"], "expect": ["sword"], "unknown": 1}
    (tmp_path / "jobs.json").write_text(json.dumps({"jobs": [job]}))
    (loaded,) = run.Job.load(tmp_path / "jobs.json")
    assert (loaded.require, loaded.expect) == (["blue_hair"], ["sword"])


class _FakeGen:
    def __init__(self):
        self.seeds = []

    def embed(self, prompt, negative):
        return None

    def render(self, emb, seed, width, height, steps=28, cfg=5.0):
        self.seeds.append(seed)
        return Image.new("RGB", (8, 8))


class _Report:
    ok, score, aesthetic, notes, issues = True, 0.5, 0.5, [], []

    def to_json(self):
        return {"ok": True, "issues": [], "notes": [], "aesthetic": 0.5, "score": 0.5}


def test_explore_with_new_seed_offset_renders_despite_earlier_accepts(tmp_path, monkeypatch):
    monkeypatch.setattr(run.qa, "inspect", lambda img, expect, require: _Report())
    job = run.Job("bb_guren", "x", 100, *["x"] * 6)
    for seed in (100, 101):
        _candidate(tmp_path, "bb_guren", seed, True, 0.9)
    gen = _FakeGen()
    run.explore(gen, [job], tmp_path, want=2, max_tries=4, log=lambda *_: None)
    assert gen.seeds == []  # this range already has enough
    run.explore(gen, [job], tmp_path, want=2, max_tries=4, seed_offset=50, log=lambda *_: None)
    assert gen.seeds == [150, 151, 152]  # one extra: inspection lags a render
