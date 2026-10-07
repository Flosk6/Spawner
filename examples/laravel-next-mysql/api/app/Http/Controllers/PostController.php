<?php

namespace App\Http\Controllers;

use App\Models\Post;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

class PostController extends Controller
{
    public function index(): Collection
    {
        return Post::query()->latest('id')->get();
    }

    public function show(Post $post): Post
    {
        return $post;
    }

    public function store(Request $request): JsonResponse
    {
        $post = Post::create($request->validate([
            'title' => ['required', 'string', 'max:200'],
            'body' => ['required', 'string'],
        ]));

        return response()->json($post, 201);
    }
}
